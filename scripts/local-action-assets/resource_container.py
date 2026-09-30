# 严格解析已有 PAP/SKLB 容器，不提取、不调用外部程序。
import struct

def unwrap(data,is_pap,expected_skeleton=101):
    if is_pap:
        if len(data)<26 or data[:4]!=b'pap ':raise ValueError('Invalid PAP header')
        count,skeleton,info,start,end=struct.unpack_from('<hiiii',data,8)
        if count!=1 or skeleton!=expected_skeleton or not 26<=info<start<end<=len(data):raise ValueError('Unsupported PAP container')
    else:
        if len(data)<16 or data[:4]!=b'blks':raise ValueError('Invalid SKLB header')
        v=struct.unpack_from('<H',data,6)[0]
        if v not in (0x3132,0x3133):raise ValueError('Unsupported SKLB version')
        start=struct.unpack_from('<H' if v==0x3132 else '<I',data,10 if v==0x3132 else 12)[0];end=len(data)
        if not 12<=start<end:raise ValueError('Invalid SKLB payload offsets')
    return data[start:end]

