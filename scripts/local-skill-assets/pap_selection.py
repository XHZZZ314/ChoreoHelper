# 多动画 PAP 按真实名称和 Havok 索引选择；原转换器先分离单段，规避其 FBX 序号参数缺陷。
from pathlib import Path
import contextlib, io, json, struct, subprocess, sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent/'local-action-assets'))
from prepare_c1201_balldance import ROOT, TOOL, EXPECTED_TOOL_HASH, sha, reference, verify_reference
from resource_container import unwrap
from fbx_clip import convert


def select(raw, animation_name):
    assert len(raw) >= 26 and raw[:4] == b'pap ', 'Invalid PAP'
    count, code, info, start, end = struct.unpack_from('<hiiii',raw,8)
    assert 0 < count <= 2048 and 26 <= info and info+count*40 <= start < end <= len(raw)
    matches = []
    for index in range(count):
        at = info+index*40
        name = raw[at:at+32].split(b'\0')[0].decode()
        if name != animation_name:
            continue
        typ, havok, face = struct.unpack_from('<hhi',raw,at+32)
        assert typ == 0 and face == 0 and 0 <= havok < count, 'Unsupported body animation entry'
        matches.append(dict(papIndex=index,havokIndex=havok,skeletonCode=code))
    assert len(matches) == 1, 'Missing or ambiguous exact animation name'
    return matches[0],raw[start:end]


def decode(pap, animation_name, output):
    pap, out = Path(pap), Path(output)
    assert sha(TOOL) == EXPECTED_TOOL_HASH, 'Original converter changed'
    entry, binary = select(pap.read_bytes(),animation_name)
    code='c'+str(entry['skeletonCode']).zfill(4)
    sk=ROOT/'assets'/(code+'.sklb'); source_xml=ROOT/'assets'/(code+'.xml')
    source=reference(source_xml)
    out.mkdir(exist_ok=False)
    manifest=dict(animation=animation_name,entry=entry,inputs={str(p):sha(p) for p in (pap,sk,source_xml,TOOL)},calls=[])
    def save():
        (out/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    def run(*args):
        r=subprocess.run([str(TOOL),*map(str,args)],capture_output=True,timeout=45)
        manifest['calls'].append(dict(args=list(map(str,args)),exit=r.returncode,stdout=r.stdout.decode(errors='replace'),stderr=r.stderr.decode(errors='replace')));save()
        assert r.returncode == 0, 'Converter failed; retain evidence, do not substitute tools'
        return r.stderr.decode().strip()
    (out/'all-animations.hkt').write_bytes(binary)
    (out/'skeleton.hkt').write_bytes(unwrap(sk.read_bytes(),False))
    run('createContainer',out/'empty.hkt')
    run('addAnimation',out/'empty.hkt',out/'all-animations.hkt',entry['havokIndex'],out/'selected.hkt')
    run('addSkeleton',out/'selected.hkt',out/'skeleton.hkt',0,out/'combined.hkt')
    assert run('getStats',out/'combined.hkt') == '1/1/1', 'Selection did not preserve exactly one animation/binding'
    run('toFbxAnimation',out/'combined.hkt',0,0,out/'animation.fbx')
    with contextlib.redirect_stdout(io.StringIO()) as log:
        clip=convert(out/'animation.fbx',out/'source.json',code)
    (out/'parser.log').write_text(log.getvalue(),encoding='utf-8')
    manifest['referenceErrors']=verify_reference(json.loads((out/(code+'-skeleton.json')).read_text(encoding='utf-8')),source)
    manifest['sourceHash']=sha(out/'source.json');save()
    return clip


if __name__ == '__main__':
    decode(*sys.argv[1:])
