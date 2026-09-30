// 这个文件是干嘛的：测试用不透明字节流（chunked oversize 探测）。
// 捐赠源：r2-preserved program.cs 的 BlindByteStream（逐字提取）。
using System;
using System.IO;

// ARCH2 测试桩：不可 seek 的定长只读流——StreamContent 对 CanSeek=false 的流走 chunked
// 发送（无声明长度），用于锁定「chunked 超限同样 413」的审计 P2 回归口径
sealed class BlindByteStream : Stream
{
    private readonly byte[] _data;
    private int _pos;

    public BlindByteStream(byte[] data) => _data = data;

    public override bool CanRead => true;
    public override bool CanSeek => false;
    public override bool CanWrite => false;
    public override long Length => _data.Length;
    public override long Position { get => _pos; set => throw new NotSupportedException(); }

    public override int Read(byte[] buffer, int offset, int count)
    {
        var n = Math.Min(count, _data.Length - _pos);
        if (n <= 0) return 0;
        Array.Copy(_data, _pos, buffer, offset, n);
        _pos += n;
        return n;
    }

    public override void Flush() { }
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
}
