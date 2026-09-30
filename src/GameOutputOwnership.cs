// 这个文件是干嘛的：把旧输出与独占试验的领取、同步写入和撤销放在同一原子边界；旧回调不能借新租约复活。
using System;
using System.Collections.Generic;

namespace ChoreoHelper;

public sealed class GameOutputOwnership
{
    private readonly object _sync = new();
    private readonly HashSet<GameOutputLease> _legacy = new();
    private GameOutputLease? _exclusive;
    private bool _disposed;
    internal object SyncRoot => _sync;

    public bool TryAcquireLegacy(string owner, out GameOutputLease? lease)
    {
        lock (_sync)
        {
            lease = null;
            if (_disposed || _exclusive != null) return false;
            lease = new GameOutputLease(this, owner, false);
            _legacy.Add(lease);
            return true;
        }
    }

    public bool TryAcquireExclusive(string owner, out GameOutputLease? lease)
    {
        lock (_sync)
        {
            lease = null;
            if (_disposed || _exclusive != null || _legacy.Count != 0) return false;
            lease = _exclusive = new GameOutputLease(this, owner, true);
            return true;
        }
    }

    public (string? ExclusiveOwner, int LegacyLeases) Snapshot()
    {
        lock (_sync) return (_exclusive?.Owner, _legacy.Count);
    }

    internal bool IsCurrent(GameOutputLease lease)
    {
        lock (_sync) return !_disposed && !lease.Revoked
            && (lease.Exclusive ? ReferenceEquals(_exclusive, lease) : _legacy.Contains(lease));
    }

    internal bool TryRun(GameOutputLease lease, Func<bool> operation)
    {
        lock (_sync)
        {
            if (!IsCurrent(lease)) return false;
            lease.ActiveCalls++;
            try { return operation(); }
            finally
            {
                lease.ActiveCalls--;
                if (lease.Revoked && lease.ActiveCalls == 0) Remove(lease);
            }
        }
    }

    internal void Release(GameOutputLease lease)
    {
        lock (_sync)
        {
            lease.Revoked = true;
            if (lease.ActiveCalls == 0) Remove(lease);
        }
    }

    private void Remove(GameOutputLease lease)
    {
        if (ReferenceEquals(_exclusive, lease)) _exclusive = null;
        else _legacy.Remove(lease);
    }

    // 仅供最终卸载：先由各 owner 完成真实清理；此处失效回调，本身不冒充按键释放。
    public void Close()
    {
        lock (_sync) { _disposed = true; _exclusive = null; _legacy.Clear(); }
    }
}

public sealed class GameOutputLease : IDisposable
{
    private readonly GameOutputOwnership _source;
    internal int ActiveCalls;
    internal bool Revoked;
    internal GameOutputLease(GameOutputOwnership source, string owner, bool exclusive)
    { _source = source; Owner = owner; Exclusive = exclusive; }
    public string Owner { get; }
    public bool Exclusive { get; }
    public bool IsCurrent => _source.IsCurrent(this);
    internal bool BelongsTo(GameOutputOwnership source) => ReferenceEquals(_source, source);
    public bool TryRun(Func<bool> operation) => _source.TryRun(this, operation);
    public void Dispose() => _source.Release(this);
}
