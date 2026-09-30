# 复用已解码 Action16140；核对原生局部映射与 TMB 动画字段，原始证据只读。
from pathlib import Path
import hashlib, json, math, struct, sys
import xml.etree.ElementTree as ET


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def floats(node):
    return [struct.unpack('<f', bytes.fromhex(v[1:])[::-1])[0] for v in node.text.split()]


def skeleton(root, identity):
    obj = root.find(f'./object[@id="{identity}"]')
    names = [x.text for x in obj.findall('./array[@name="bones"]/struct/string[@name="name"]')]
    parents = list(map(int, obj.find('./array[@name="parentIndices"]').text.split()))
    poses = [floats(x) for x in obj.findall('./array[@name="referencePose"]/vec12')]
    assert len(names) == len(parents) == len(poses)
    return {'count': len(names), 'bones': [dict(i=i, n=n, p=parents[i], t=poses[i][:3], q=poses[i][4:8], s=poses[i][8:11]) for i, n in enumerate(names)]}


def mul(a, b):
    x,y,z,w=a; X,Y,Z,W=b
    q=[w*X+x*W+y*Z-z*Y,w*Y-x*Z+y*W+z*X,w*Z+x*Y-y*X+z*W,w*W-x*X-y*Y-z*Z]
    length=math.sqrt(sum(v*v for v in q))
    return [v/length for v in q]


def mappings(root, identity):
    obj=root.find(f'./object[@id="{identity}"]/struct[@name="mapping"]')
    assert obj.find('./int[@name="mappingType"]').text == '1', 'Only local-space mapping'
    chains=obj.find('./array[@name="chainMappings"]')
    assert chains is None or int(chains.get('size')) == 0, 'Chain mapping unsupported'
    def integer(x, key):
        n=x.find(f'./int[@name="{key}"]');return int(n.text) if n is not None else 0
    return [(integer(x,'boneA'), integer(x,'boneB'), floats(x.find('./vec12'))) for x in obj.findall('./array[@name="simpleMappings"]/struct')]


def retarget(clip, source, target, mapping):
    # SKLB 的局部平移比例/偏移和局部左乘旋转；不把平移比例重复乘到身体缩放。
    # 仅用于网页预览；原文件与 source 关键帧完整保留，不推导游戏执行语义。
    out={};seen=set();errors={'t':0,'q':0,'s':0}
    for a,b,m in mapping:
        assert b not in seen and 0<=a<source['count'] and 0<=b<target['count'];seen.add(b)
        A,B=source['bones'][a],target['bones'][b]
        assert A['n']==B['n'], 'Native mapping name correspondence differs'
        def t(v):return [v[i]*m[8+i]+m[i] for i in range(3)]
        def q(v):return mul(m[4:8],v)
        def s(v):return [v[i]/A['s'][i]*B['s'][i] for i in range(3)]
        for key,fn in [('t',t),('q',q),('s',s)]:
            v=fn(A[key]);error=max(abs(x-y) for x,y in zip(v,B[key]))
            if key=='q':error=min(error,max(abs(x+y) for x,y in zip(v,B[key])))
            errors[key]=max(errors[key],error)
        ch=clip['bones']['bone_'+str(a)]
        out['bone_'+str(b)]={key:[[row[0],*fn(row[1:])] for row in ch[key]] for key,fn in [('t',t),('q',q),('s',s)]}
    assert len(seen)==target['count'], 'Unmapped target bones require explicit handling'
    assert max(errors.values())<1e-5, errors
    assert all(math.isfinite(v) for ch in out.values() for keys in ch.values() for row in keys for v in row)
    return dict(clip,bones=out,type='once'),errors


def phase(path, expected, duration):
    raw=path.read_bytes();assert raw[:4]==b'TMLB' and struct.unpack_from('<i',raw,4)[0]==len(raw)
    at=12;entries=[]
    for _ in range(struct.unpack_from('<i',raw,8)[0]):
        tag=raw[at:at+4];size=struct.unpack_from('<i',raw,at+4)[0];assert 8<=size<=len(raw)-at
        if tag==b'C010':
            assert size==40
            identity,start=struct.unpack_from('<hh',raw,at+8)
            frames,unknown,flags=struct.unpack_from('<iii',raw,at+12)
            first,last=struct.unpack_from('<ff',raw,at+24)
            pos=at+8+struct.unpack_from('<i',raw,at+32)[0]
            name=raw[pos:raw.index(0,pos)].decode();assert name==expected
            # 本例 flags=0：没有启用 Animation Start/End 时间控制，不能把禁用字段50当裁切长度。
            assert flags in (0,1) and start>=0, 'Unknown animation flags or negative phase offset'
            stage=dict(role='execution',timelineHash=sha(path),entryId=identity,offset=start/30,sourceStart=0,duration=duration,mode='natural',raw=dict(startFrame=start,durationFrames=frames,flags=flags,animationStart=first,animationEnd=last))
            if flags==1:
                # C010 明确启用帧范围与阶段长度；网页按范围线性采样，原始关键帧保持不变。
                assert frames>0 and math.isfinite(first) and math.isfinite(last) and 0<=first<=last<=duration*30+1e-5, 'Controlled phase outside original frames'
                stage.update(sourceStart=first/30,duration=frames/30,rate=(last-first)/frames,mode='time-controlled')
            entries.append(stage)
        at+=size
    assert len(entries)==1, 'Multiple animation phases require an explicit composition'
    return entries[0]


def main(evidence, output):
    base=Path(evidence);dest=Path(output);dest.mkdir(exist_ok=False)
    inspect=base/'action16140/conversion-inspect';clip=json.loads((inspect/'action16140-source.json').read_text())
    xml=ET.parse(inspect/'target-skeleton.xml').getroot();A=skeleton(xml,'#0003');B=skeleton(xml,'#0004')
    mapped,errors=retarget(clip,A,B,mappings(xml,'#0005'))
    manifest=dict(sourceClipHash=sha(inspect/'action16140-source.json'),sourceSkeletonHash=sha(inspect/'verified-source.hkt'),targetSkeletonHash=sha(base/'action16140/skl_c1201b0001.sklb'),mappingXmlHash=sha(inspect/'target-skeleton.xml'),mappingObject='#0005',referenceErrors=errors,phase=phase(base/'action16140/execution.tmb','cbbm_abl182',clip['duration']),dynamicFrameCount=len(clip['bones']['bone_0']['q']),webAppearanceAccepted=False,gameExecutionAccepted=False)
    for n,v in [('c1201-candidate.json',mapped),('c0101-source.json',dict(clip,type='once')),('c0101-skeleton.json',A),('c1201-skeleton.json',B),('manifest.json',manifest)]:
        (dest/n).write_text(json.dumps(v,separators=(',',':')),encoding='utf-8')
    print(json.dumps(manifest))


if __name__=='__main__':main(*sys.argv[1:])
