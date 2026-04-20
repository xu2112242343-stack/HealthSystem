import React, { useEffect, useState } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import { ApiError } from '@/lib/api';
import {
  createAdminUser,
  deleteAdminUser,
  fetchAdminUserDetail,
  fetchAdminUsers,
  type AdminUserDetail,
  type AdminUserRow,
  resetAdminUserPassword,
} from '@/lib/api/adminUsers';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/app/components/ui/table';

interface Props {
  onBack: () => void;
}

function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return '请求失败，请稍后重试';
}

export function AdminUserManagementMvpPage({ onBack }: Props) {
  const [keyword, setKeyword] = useState('');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<AdminUserDetail | null>(null);
  const [message, setMessage] = useState('');

  const [createForm, setCreateForm] = useState({
    account: '',
    password: '',
    name: '',
    phone: '',
    email: '',
  });

  async function loadList(nextPage = page, nextQuery = query) {
    setLoading(true);
    setError('');
    try {
      const res = await fetchAdminUsers({ keyword: nextQuery, page: nextPage, pageSize });
      setRows(Array.isArray(res.items) ? res.items : []);
      setTotal(res.total);
    } catch (e) {
      setRows([]);
      setTotal(0);
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadList(1, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSearch() {
    setQuery(keyword.trim());
    setPage(1);
    await loadList(1, keyword.trim());
  }

  async function onSelect(id: number) {
    try {
      const detail = await fetchAdminUserDetail(id);
      setSelected(detail);
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function onDelete(row: AdminUserRow) {
    const ok = window.confirm(`确定注销用户 ${row.account} 吗？\n\n此操作将从数据库中删除该账户，且不可恢复。`);
    if (!ok) return;
    try {
      await deleteAdminUser(row.id);
      setMessage(`用户${row.account}已注销（已从数据库删除）`);
      await loadList();
      if (selected?.id === row.id) setSelected(null);
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function onResetPassword(row: AdminUserRow) {
    const v = window.prompt(`请输入 ${row.account} 的新密码（至少6位）`);
    if (!v) return;
    if (v.trim().length < 6) {
      setError('新密码至少 6 位');
      return;
    }
    try {
      await resetAdminUserPassword(row.id, v.trim());
      setMessage(`用户${row.account}密码已重置`);
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function onCreate() {
    if (!createForm.account.trim() || createForm.password.trim().length < 6) {
      setError('请填写账号，且密码不少于6位');
      return;
    }
    try {
      await createAdminUser({
        account: createForm.account.trim(),
        password: createForm.password.trim(),
        name: createForm.name.trim() || undefined,
        phone: createForm.phone.trim() || undefined,
        email: createForm.email.trim() || undefined,
      });
      setMessage('用户创建成功');
      setCreateForm({ account: '', password: '', name: '', phone: '', email: '' });
      await loadList(1, query);
    } catch (e) {
      setError(errorText(e));
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="p-6 space-y-4">
      <button onClick={onBack} className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors">
        <ArrowLeft className="w-5 h-5" />
        <span className="text-sm font-medium">返回用户账户管理</span>
      </button>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">创建用户</h2>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
          <Input placeholder="账号*" value={createForm.account} onChange={(e) => setCreateForm((s) => ({ ...s, account: e.target.value }))} />
          <Input placeholder="密码(>=6)*" type="password" value={createForm.password} onChange={(e) => setCreateForm((s) => ({ ...s, password: e.target.value }))} />
          <Input placeholder="姓名" value={createForm.name} onChange={(e) => setCreateForm((s) => ({ ...s, name: e.target.value }))} />
          <Input placeholder="电话" value={createForm.phone} onChange={(e) => setCreateForm((s) => ({ ...s, phone: e.target.value }))} />
          <Input placeholder="邮箱" value={createForm.email} onChange={(e) => setCreateForm((s) => ({ ...s, email: e.target.value }))} />
        </div>
        <Button onClick={onCreate}>创建用户</Button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input className="pl-10" placeholder="搜索账号/姓名/电话/邮箱" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          </div>
          <Button onClick={onSearch}>搜索</Button>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>账号</TableHead>
              <TableHead>姓名</TableHead>
              <TableHead>电话</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rows ?? []).map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.id}</TableCell>
                <TableCell>{r.account}</TableCell>
                <TableCell>{r.name || '-'}</TableCell>
                <TableCell>{r.phone || '-'}</TableCell>
                <TableCell className="text-right space-x-2">
                  <Button size="sm" variant="outline" onClick={() => onSelect(r.id)}>详情</Button>
                  <Button size="sm" variant="destructive" onClick={() => onDelete(r)}>注销</Button>
                  <Button size="sm" onClick={() => onResetPassword(r)}>重置密码</Button>
                </TableCell>
              </TableRow>
            ))}
            {!rows.length && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-gray-500 py-8">
                  {loading ? '加载中...' : '暂无数据'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        <div className="mt-3 flex items-center justify-between text-sm">
          <span>共 {total} 条</span>
          <div className="space-x-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={async () => {
                const next = Math.max(1, page - 1);
                setPage(next);
                await loadList(next, query);
              }}
            >
              上一页
            </Button>
            <span>{page}/{totalPages}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages}
              onClick={async () => {
                const next = Math.min(totalPages, page + 1);
                setPage(next);
                await loadList(next, query);
              }}
            >
              下一页
            </Button>
          </div>
        </div>
      </div>

      {selected && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 text-sm space-y-1">
          <h3 className="font-semibold">用户详情：{selected.account}</h3>
          <div>姓名：{selected.name || '-'}</div>
          <div>电话：{selected.phone || '-'}</div>
          <div>邮箱：{selected.email || '-'}</div>
          <div>年龄：{selected.age ?? '-'}</div>
          <div>性别：{selected.gender || '-'}</div>
        </div>
      )}

      {(error || message) && (
        <div className="text-sm">
          {error ? <p className="text-red-600">{error}</p> : null}
          {message ? <p className="text-emerald-600">{message}</p> : null}
        </div>
      )}
    </div>
  );
}
