# 将 XAT 本地输出的 FBX 动作转为网页关键帧；非通用 FBX 导入器，遇到不支持的变换拒绝。
from pathlib import Path
import struct, zlib, os, json, math, hashlib, base64



def read_fbx(path):
    data=path.read_bytes()
    assert data[:23] == b'Kaydara FBX Binary  \x00\x1a\x00'
    version=struct.unpack_from('<I',data,23)[0]
    assert 7100 <= version < 7500, f'unsupported FBX version {version}'
    def parse(offset):
        end,count,propsize,nlen=struct.unpack_from('<IIIB',data,offset)
        if end==0: return None, offset+13
        assert offset < end <= len(data) and count < 10000
        offset+=13; name=data[offset:offset+nlen].decode(); offset+=nlen; values=[]
        prop_end=offset+propsize
        for _ in range(count):
            kind=chr(data[offset]); offset+=1
            fmt={'Y':'h','C':'?','I':'i','F':'f','D':'d','L':'q'}.get(kind)
            if fmt:
                values.append(struct.unpack_from('<'+fmt,data,offset)[0]); offset+=struct.calcsize(fmt)
            elif kind in ('S','R'):
                size=struct.unpack_from('<I',data,offset)[0]; offset+=4
                val=data[offset:offset+size]; offset+=size
                values.append(val.decode('utf-8') if kind=='S' else val)
            elif kind in 'fdlibc':
                size,encoding,nbytes=struct.unpack_from('<III',data,offset); offset+=12
                assert size <= 10000000 and encoding in (0,1)
                buf=data[offset:offset+nbytes]; offset+=nbytes
                if encoding: buf=zlib.decompress(buf)
                fmt={'f':'f','d':'d','l':'q','i':'i','b':'?','c':'b'}[kind]
                assert len(buf)==size*struct.calcsize(fmt)
                values.append(list(struct.unpack('<'+str(size)+fmt,buf)))
            else: raise ValueError('unsupported property '+kind)
        assert offset==prop_end
        children=[]
        while offset<end:
            child,offset=parse(offset)
            if child is not None: children.append(child)
        assert offset==end
        return {'name':name,'values':values,'children':children},end
    nodes=[]; offset=27
    while True:
        node,offset=parse(offset)
        if node is None: break
        nodes.append(node)
    return nodes

def child(n,name):
    return next(x for x in n['children'] if x['name']==name)

def euler_xyz_static(vals):
    x,y,z=(v*math.pi/360 for v in vals)
    sx,cx,sy,cy,sz,cz=math.sin(x),math.cos(x),math.sin(y),math.cos(y),math.sin(z),math.cos(z)
    # XAT uses EulOrdXYZs: fixed-axis X,Y,Z = qz*qy*qx.
    return [sx*cy*cz-cx*sy*sz,cx*sy*cz+sx*cy*sz,cx*cy*sz-sx*sy*cz,cx*cy*cz+sx*sy*sz]

def convert(path, output, skeleton_name='c0101'):
    tree=read_fbx(path); objs=next(x for x in tree if x['name']=='Objects')['children']
    conns=next(x for x in tree if x['name']=='Connections')['children']
    byid={o['values'][0]:o for o in objs}
    models=[o for o in objs if o['name']=='Model']
    print('object counts', {kind:sum(o['name']==kind for o in objs) for kind in sorted(set(o['name'] for o in objs))})
    print('models', [(m['values'][0],m['values'][1]) for m in models[:6]])
    parents={c['values'][1]:c['values'][2] for c in conns if c['values'][0]=='OO' and c['values'][1] in byid and byid[c['values'][1]]['name']=='Model'}
    skeleton=[]; clips={}; name_to_i={}
    for model in models:
        mid=model['values'][0]; name=model['values'][1].split('\x00')[0]
        props={p['values'][0]:p['values'][4:] for p in child(model,'Properties70')['children']}