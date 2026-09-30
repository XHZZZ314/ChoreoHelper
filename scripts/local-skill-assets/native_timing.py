# 原生动画读数附着到既有原帧资源；不解码、不变速、不推算未观测的阶段边界。
import copy
import hashlib
import json


def attach(clip, rows, observation_hash, expected_actor, expected_job, action_id, timeline_ids):
    if str(clip['motionBinding']['source']['id']) != str(action_id):
        raise ValueError('Wrong Action resource')
    if any(b['observedAtMs'] <= a['observedAtMs'] for a, b in zip(rows, rows[1:])):
        raise ValueError('Non-monotonic observations')
    if sum(bool(r['isCasting']) and (i == 0 or not rows[i-1]['isCasting']) for i, r in enumerate(rows)) != 1:
        raise ValueError('Expected one manual cast')
    casting = [r for r in rows if r['isCasting']]
    if not casting or any(r['castActionId'] != action_id for r in casting):
        raise ValueError('Expected exactly the requested casting action')
    if any(r['actorId'] != expected_actor or r['jobId'] != expected_job for r in rows):
        raise ValueError('Actor or job changed')
    cast_ms = {round(r['totalCastTime'] * 1000) for r in casting}
    if len(cast_ms) != 1 or min(cast_ms) <= 0:
        raise ValueError('Inconsistent actual cast time')
    result = copy.deepcopy(clip)
    parts = {'start': result['castPreview']['start'], 'loop': result['castPreview']['loop'], 'execution': result}
    origin = casting[0]['observedAtMs'] - casting[0]['currentCastTime'] * 1000
    samples, role, finished = [], None, False
    for r in rows:
        if r['observedAtMs'] < casting[0]['observedAtMs']:
            continue
        tl = r['timelines'][0]['id'] if r['timelines'] else None
        next_role = next((k for k, v in timeline_ids.items() if v == tl), None)
        controls = r['controls']
        if next_role:
            matches = [c for c in controls if abs(c['duration'] - parts[next_role]['duration']) < 1e-5]
            if matches:
                role = next_role
                control = matches[-1]  # Newest controller; old controller remains during native blend.
            else:
                matches = [c for c in controls if role and abs(c['duration'] - parts[role]['duration']) < 1e-5]
                if not matches:
                    raise ValueError('Unidentified active animation controller')
                control = matches[-1]
        else:
            if role != 'execution':
                raise ValueError('Unexpected timeline during cast')
            matches = [c for c in controls if abs(c['duration'] - parts[role]['duration']) < 1e-5]
            if not matches:
                end = (r['observedAtMs'] - origin) / 1000
                finished = True
                break
            control = matches[-1]
        if control['speed'] not in (0, 1) or r['overallSpeed'] != 1:
            raise ValueError('Unvalidated native playback speed')
        samples.append({'at': (r['observedAtMs'] - origin) / 1000, 'role': role, 'time': control['localTime']})
    if not finished or {s['role'] for s in samples} != set(parts):
        raise ValueError('Incomplete native phases')
    gap = max([b['at'] - a['at'] for a, b in zip(samples, samples[1:])] + [end - samples[-1]['at']])
    if gap > .25:
        raise ValueError('Native observation gap exceeds 250 ms')
    for part in parts.values():
        phase = part['motionBinding']['phase']
        if phase.pop('timingPolicy', None) == 'observed-transition-linear-preview':
            phase['duration'] = part['duration']
            phase['rate'] = 1
        if phase.get('rate', 1) != 1:
            raise ValueError('Raw phase speed must match observed native speed')
    target = result['motionBinding']['target']
    result['nativeTiming'] = dict(version=1, kind='native-control-observation', observationHash=observation_hash,
        profileId=target['profileId'], skeletonHash=target['skeletonHash'], actionId=action_id,
        actorId=expected_actor, jobId=expected_job, castMs=next(iter(cast_ms)), samples=samples,
        end=end, maxSampleGap=gap + 1e-9, scope='one-observed-state', transitionPolicy='sampled-boundaries-not-execution-clearance')
    result['castPreview']['observationHash'] = observation_hash
    result['castPreview']['observedCastSeconds'] = next(iter(cast_ms)) / 1000
    return result


def file_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
