# 由已捕获的真实绑定选择目标骨架；通用准备入口不内置职业、种族或舞者档案。
from pathlib import Path
import hashlib, json, re, sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'local-action-assets'))
from prepare_c1201_balldance import reference, verify_reference


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def checked_path(spec):
    path = Path(spec['path'])
    if not re.fullmatch('[a-f0-9]{64}', spec.get('sha256', '')) or hashlib.sha256(path.read_bytes()).hexdigest() != spec['sha256']:
        raise ValueError('Captured input hash changed: ' + str(path))
    return path


def validate_target(bound, captured, profile, target, binary_hash):
    if not re.fullmatch(r'c\d{4}', bound.get('sourceSkeletonCode', '')) or not re.fullmatch('[1-9][0-9]*', bound.get('actorId', '')):
        raise ValueError('Missing actual character and skeleton identity')
    if not isinstance(bound.get('animationVariant'), int) or any(captured.get(k) != bound[k] for k in ('actorId', 'sourceSkeletonCode', 'animationVariant')):
        raise ValueError('Character, skeleton or animation variant changed during capture')
    resource = captured.get('resource') or {}
    if resource.get('sha256') != binary_hash or not any(r.get('slot') == 0 and r.get('group') == 'skeleton' and r.get('path') == resource.get('path') for r in bound.get('resources', [])):
        raise ValueError('Target is not the hash-verified, actually bound base skeleton')
    if not profile.get('id') or not re.fullmatch('[a-f0-9]{64}', profile.get('skeletonHash', '')):
        raise ValueError('An existing isolated target profile is required')
    verify_reference(profile['skeleton'], target)
    return dict(profileId=profile['id'], skeletonHash=profile['skeletonHash'])


def load_context(filename):
    config = read(filename)
    if config.get('version') != 1:
        raise ValueError('Unsupported variant capture manifest')
    paths = {key: checked_path(config[key]) for key in ('binding', 'skeletonRead', 'skeletonBinary', 'skeletonXml', 'profile', 'papIndex')}
    bindings, captured, profile = (read(paths[k]) for k in ('binding', 'skeletonRead', 'profile'))
    target = reference(paths['skeletonXml'])
    binding = validate_target(bindings, captured, profile, target, config['skeletonBinary']['sha256'])
    return dict(xmlpath=paths['skeletonXml'], target=target, binding=dict(target=binding),
                bindings=bindings, binding_file=paths['binding'], index=read(paths['papIndex']),
                pap_folder=Path(config['papDirectory']), references=[checked_path(p) for p in config['references']],
                target_code=bindings['sourceSkeletonCode'])
