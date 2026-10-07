"use client";
import React, { useState, useEffect } from 'react';
import { activePhases, dateInShanghai, formatShanghai, nextAt, phaseNames, upcomingPlans } from '@/lib/display-time';
import { Battery, Zap, Clock, Settings, List, Info, AlertTriangle, Plus, Trash2, RefreshCw, LogOut, Eye, EyeOff, Calendar, CalendarClock, Power } from 'lucide-react';
import './charge-dashboard.css';
import MobileSupport from './mobile-support';

export interface ChargeDashboardProps {
  state: {
    userEmail: string;
    configured: boolean;
    chargingEnabled: boolean;
    storageMode?: 'browser';
    executionMessage?: string;
    targets: Array<{id: string, label: string, device: string, port: string}>;
    preferences: {defaultTime: string, weekdays: number[], maxPrepayCents: number};
    reservations: Array<{id: string, target_id: string, scheduled_at: string, phase: string, result?: unknown, created_at: string}>;
    live: null | {balanceCents: number, powerWatts: number | null, businessOpen: boolean, activeOrder: boolean, updatedAt: string};
    error?: string;
  };
  busy: boolean;
  onAction: (action: string, payload: Record<string, unknown>) => Promise<void>;
  onLogout: () => void;
}

export default function ChargeDashboard({ state, busy, onAction, onLogout }: ChargeDashboardProps) {
  const [tab, setTab] = useState<'overview' | 'settings' | 'history'>('overview');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(interval);
  }, []);

  const formatMoney = (cents: number) => (cents / 100).toFixed(2);
  const formatDate = (iso: string) => {
    if (!iso) return '-';
    try {
      const d = new Date(iso);
      return isNaN(d.getTime()) ? '-' : formatShanghai(iso);
    } catch {
      return '-';
    }
  };
  const parseResult = (res: unknown) => {
    if (res === undefined || res === null) return '-';
    if (typeof res === 'string') return res;
    try {
      const s = JSON.stringify(res);
      return s.length > 20 ? s.substring(0, 20) + '...' : s;
    } catch {
      return '未知';
    }
  };

  if (!state.configured) {
    return <ImportAccountView onAction={onAction} busy={busy} onLogout={onLogout} error={state.error} />;
  }

  return (
    <div className='charge-app nh-container'>
      <nav className='nh-nav'>
        <div className='nh-nav-header'>
          <Zap className='nh-logo-icon' />
          <h2>晨充 Hub</h2>
        </div>
        <div className='nh-nav-menu'>
          <button className={`nh-nav-item ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')} disabled={busy}>
            <Battery size={20} /><span>充电概览</span>
          </button>
          <button className={`nh-nav-item ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')} disabled={busy}>
            <Settings size={20} /><span>偏好设置</span>
          </button>
          <button className={`nh-nav-item ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')} disabled={busy}>
            <List size={20} /><span>历史记录</span>
          </button>
        </div>
        <div className='nh-nav-footer'>
          <div className='nh-user-email'>{state.userEmail}</div>
          <button className='nh-btn nh-btn-outline nh-btn-logout' onClick={onLogout} disabled={busy}>
            <LogOut size={16} /> 锁定本机数据
          </button>
        </div>
      </nav>

      <main className='nh-main'>
        {state.error && (
          <div className='nh-error-banner' role='status'>
            <AlertTriangle size={18} />
            <span>{state.error}</span>
          </div>
        )}

        <div className='nh-content'>
          <header className='nh-page-heading'><div><span className='nh-eyebrow'>NEPTUNE · 本机加密空间</span><h1>{tab === 'overview' ? '安排好下一程。' : tab === 'settings' ? '按你的习惯来。' : '每一次，都有记录。'}</h1></div><button className='nh-mobile-logout nh-icon-btn' onClick={onLogout} aria-label='锁定本机数据'><LogOut size={20} /></button></header>
          <p className='nh-local-notice' role='note'>{state.executionMessage}</p>
          {tab === 'overview' && <OverviewTab state={state} busy={busy} onAction={onAction} />}
          {tab === 'settings' && <SettingsTab state={state} busy={busy} onAction={onAction} />}
          {tab === 'history' && <HistoryTab state={state} busy={busy} onAction={onAction} now={now} parseResult={parseResult} formatDate={formatDate} />}
          <MobileSupport />
        </div>
      </main>
    </div>
  );
}

function ImportAccountView({ onAction, busy, onLogout, error }: { onAction: ChargeDashboardProps['onAction'], busy: boolean, onLogout: () => void, error?: string }) {
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [showPwd, setShowPwd] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^https?:\/\//.test(url.trim())) {
      alert('请复制微信尼普顿付款页的完整链接');
      return;
    }
    try {
      await onAction('importAccount', { url: url.trim(), label: label.trim() || '常用充电点' });
      setUrl('');
    } catch (err) {
      alert(err instanceof Error ? err.message : '导入失败');
    }
  };

  return (
    <div className='nh-container nh-center'>
      <div className='nh-card nh-import-card'>
        <div className='nh-card-header'>
          <Zap size={24} className='nh-text-accent' />
          <h2>连接自己的尼普顿账号</h2>
        </div>
        <form onSubmit={handleSubmit} className='nh-form'>
          <p className='nh-text-sm nh-text-muted'>在微信扫描插座二维码，进入付款页，复制完整链接。链接只在当前设备解析，账号随后加密保存在本机。此处不验证平台账号或收费，也不启动充电。</p>
          {error && <div className='nh-error-banner' role='status'>{error}</div>}
          <div className='nh-form-group'>
            <label htmlFor='import-label'>充电点名称（可选）</label>
            <input id='import-label' type='text' maxLength={40} value={label} onChange={e => setLabel(e.target.value)} placeholder='如：宿舍楼下' disabled={busy} />
          </div>
          <div className='nh-form-group'>
            <label htmlFor='import-url'>微信付款页完整链接</label>
            <div className='nh-input-group'>
              <input id='import-url' autoComplete='off' spellCheck={false} type={showPwd ? 'text' : 'password'} value={url} onChange={e => setUrl(e.target.value)} required placeholder='https://...' disabled={busy} />
              <button type='button' className='nh-icon-btn' aria-label={showPwd ? '隐藏链接' : '显示链接'} onClick={() => setShowPwd(!showPwd)} disabled={busy}>
                {showPwd ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <div className='nh-help-text nh-text-danger nh-flex-align'>
              <AlertTriangle size={14} /> 链接等同账号凭据，请勿分享给他人
            </div>
          </div>
          <button type='submit' className='nh-btn nh-btn-primary' disabled={busy || !url}>保存到本机</button>
          <button type='button' className='nh-btn nh-btn-outline' onClick={onLogout} disabled={busy}>锁定本机数据</button>
        </form>
        <MobileSupport />
      </div>
    </div>
  );
}

function OverviewTab({ state, busy, onAction }: { state: ChargeDashboardProps['state'], busy: boolean, onAction: ChargeDashboardProps['onAction'] }) {
  const handleRefresh = async () => {
    try {
      await onAction('refresh', {});
    } catch (err) {
      alert(err instanceof Error ? err.message : '刷新失败');
    }
  };

  return (
    <div className='nh-tab-content'>
      <NextChargeCard state={state} busy={busy} onAction={onAction} />
      <div className='nh-live-section'>
        <div className='nh-card nh-live-card'>
          <div className='nh-card-header nh-flex-between'>
            <h3 className='nh-flex-align'><Power size={20} /> 执行状态</h3>
            <button className='nh-btn nh-btn-outline nh-btn-sm' onClick={handleRefresh} disabled={busy}>
              <RefreshCw size={14} className={busy ? 'nh-spin' : ''} /> 刷新本机记录
            </button>
          </div>
          {state.live ? (
            <div className='nh-live-grid'>
              <div className='nh-live-item'>
                <span className='nh-label'>余额</span>
                <strong className='nh-value'>{(state.live.balanceCents / 100).toFixed(2)} 元</strong>
              </div>
              <div className='nh-live-item'>
                <span className='nh-label'>瞬时功率</span>
                <strong className='nh-value'>{state.live.powerWatts !== null ? `${state.live.powerWatts} W` : '未知'}</strong>
              </div>
              <div className='nh-live-item'>
                <span className='nh-label'>服务状态</span>
                <strong className='nh-value'>{state.live.businessOpen ? '营业中' : '休息中'}</strong>
              </div>
              <div className='nh-live-item'>
                <span className='nh-label'>活跃订单</span>
                <strong className='nh-value nh-text-accent'>{state.live.activeOrder ? '进行中' : '无'}</strong>
              </div>
              <div className='nh-live-item nh-full-col nh-text-muted nh-text-sm'>
                数据时间：{formatShanghai(state.live.updatedAt)}（北京时间）
              </div>
            </div>
          ) : (
            <div className='nh-empty-state'>尚未连接执行器。余额、订单与功率请在微信查看。</div>
          )}
        </div>
      </div>

      <ProgressCard state={state} busy={busy} onAction={onAction} />

      <div className='nh-card nh-safety-card'>
        <div className='nh-card-header'>
          <h4 className='nh-flex-align'><Info size={16} /> 安全与使用说明</h4>
        </div>
        <ul className='nh-text-sm nh-text-muted nh-list'>
          <li>每次预约都需确认车辆已接好；</li>
          <li>最长480分钟不等于9点自动停止；</li>
          <li>最终金额和是否充电以平台真实状态为准；</li>
          <li>跨周计划仅偏好，不会自动为公共插座循环开电。</li>
        </ul>
      </div>
    </div>
  );
}

function NextChargeCard({ state, busy, onAction }: { state: ChargeDashboardProps['state'], busy: boolean, onAction: ChargeDashboardProps['onAction'] }) {
  const [targetId, setTargetId] = useState(state.targets[0]?.id || '');
  
  const today = dateInShanghai();
  const maxDay = dateInShanghai(Date.now() + 24 * 3600_000);
  const initial = nextAt(state.preferences.defaultTime);
  const [date, setDate] = useState(dateInShanghai(Date.parse(initial)));
  const [time, setTime] = useState(state.preferences.defaultTime || '06:00');
  const [confirmedPlug, setConfirmedPlug] = useState(false);

  const hasConflict = state.reservations.some(r => activePhases.includes(r.phase));
  const isServiceReady = state.configured && state.chargingEnabled;
  const selectedAt = Date.parse(`${date}T${time}:00+08:00`);
  const timeValid = selectedAt >= Date.now() + 60_000 && selectedAt <= Date.now() + 24 * 3600_000;
  const canSubmit = !busy && isServiceReady && !hasConflict && confirmedPlug && !!targetId && timeValid;
  const plans = upcomingPlans(state.preferences);

  const handleReserve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      const scheduledAt = new Date(selectedAt).toISOString();
      const idempotencyKey = crypto.randomUUID();
      await onAction('reserve', {
        targetId,
        scheduledAt,
        confirmedPlug: true,
        idempotencyKey
      });
      setConfirmedPlug(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : '预约失败');
    }
  };

  useEffect(() => {
    if (!state.targets.some(t => t.id === targetId) && state.targets.length > 0) {
      setTargetId(state.targets[0].id);
    }
  }, [state.targets, targetId]);

  return (
    <div className='nh-card nh-reserve-card'>
      <div className='nh-card-header'>
        <h3 className='nh-flex-align'><CalendarClock size={20} /> 下一次充电</h3>
      </div>
      {state.targets.length === 0 ? (
        <div className='nh-empty-state nh-text-sm'>请先在“偏好设置”中添加目标插座</div>
      ) : (
        <form onSubmit={handleReserve} className='nh-form'>
          <div className='nh-form-group'>
            <label htmlFor='reserve-target'>充电点与插座</label>
            <select id='reserve-target' value={targetId} onChange={e => setTargetId(e.target.value)} required disabled={busy}>
              {state.targets.map(t => (
                <option key={t.id} value={t.id}>{t.label} · {t.device} / {t.port}号插座</option>
              ))}
            </select>
          </div>
          <div className='nh-grid-2'>
            <div className='nh-form-group'>
              <label htmlFor='reserve-date'>启动日期</label>
              <input id='reserve-date' type='date' min={today} max={maxDay} value={date} onChange={e => setDate(e.target.value)} required disabled={busy} />
            </div>
            <div className='nh-form-group'>
              <label htmlFor='reserve-time'>启动时间</label>
              <input id='reserve-time' type='time' value={time} onChange={e => setTime(e.target.value)} required disabled={busy} />
            </div>
          </div>
          <p className='nh-help-text'>日期与时间均按北京时间。</p>
          <div className='nh-form-group nh-checkbox-group'>
            <label className='nh-checkbox-label'>
              <input type='checkbox' checked={confirmedPlug} onChange={e => setConfirmedPlug(e.target.checked)} disabled={busy} />
              <span>我的车已接好，插座与设备无误</span>
            </label>
          </div>
          
          {!isServiceReady && <div className='nh-help-text nh-text-danger'>请先保存本机账号与设置。</div>}
          <p className='nh-help-text'>此按钮只保存本机计划；安卓后台执行与苹果快捷指令尚未接入，不会自动开电。</p>
          {!timeValid && <div className='nh-help-text nh-text-danger'>请安排1分钟后至24小时内的启动时间。</div>}
          {hasConflict && <div className='nh-help-text nh-text-danger'>当前已有进行中的计划，无法重复预约。</div>}
          
          <div className='nh-reserve-confirm'>
            <span className='nh-text-sm nh-text-muted'>最多预扣金额: {(state.preferences.maxPrepayCents / 100).toFixed(2)}元</span>
            <button type='submit' className='nh-btn nh-btn-primary nh-btn-lg' disabled={!canSubmit}>
              {busy ? '正在加密保存…' : '已接好，保存本机计划'}
            </button>
          </div>
        </form>
      )}
      <div className='nh-plan-list'><span className='nh-text-sm nh-text-muted'>按星期偏好的安排建议</span><div>{plans.map(at => <button key={at} type='button' className='nh-plan-chip' disabled={busy || Date.parse(at) > Date.now() + 24 * 3600_000} onClick={() => {setDate(dateInShanghai(Date.parse(at))); setTime(state.preferences.defaultTime); setConfirmedPlug(false);}}>{formatShanghai(at)}</button>)}</div><p className='nh-help-text'>仅作安排建议；24小时以内、接好车辆后才能确认一次预约。</p></div>
    </div>
  );
}

function ProgressCard({ state, busy, onAction }: { state: ChargeDashboardProps['state']; busy: boolean; onAction: ChargeDashboardProps['onAction'] }) {
  const booking = state.reservations.find(r => activePhases.includes(r.phase)) ?? state.reservations[0];
  if (!booking) return null;
  const target = state.targets.find(t => t.id === booking.target_id);
  const steps = ['预约已生效', '等待恢复营业', '核对并开电', '平台确认启动'];
  const position = ['confirmed', 'already-charging'].includes(booking.phase) ? 3 : ['submitting', 'pending', 'checking'].includes(booking.phase) ? 2 : booking.phase === 'waiting' ? 1 : 0;
  const cancelable = booking.phase === 'planned' || ['queued', 'scheduled'].includes(booking.phase) && Date.parse(booking.scheduled_at) > Date.now() + 30_000;
  return <section className='nh-card nh-progress-card' aria-label='最近预约进度'>
    <div className='nh-flex-between'><h3>本次进度</h3><span className={`nh-badge nh-phase-${booking.phase}`}>{phaseNames[booking.phase] ?? '正在核对'}</span></div>
    <p className='nh-text-sm nh-text-muted'>{target?.label ?? '已预约的充电点'} · {formatShanghai(booking.scheduled_at)}</p>
    {state.storageMode !== 'browser' && <ol className='nh-progress-steps'>{steps.map((step, i) => <li key={step} className={i <= position ? 'complete' : ''}><span>{i + 1}</span>{step}</li>)}</ol>}
    <p className='nh-text-sm nh-text-muted' role='status'>{parseBookingResult(booking.result) || '记录保存在当前设备。'}</p>
    <div className='nh-local-actions'>{cancelable && <button className='nh-btn nh-btn-outline' disabled={busy} onClick={() => void onAction('cancel', { id: booking.id }).catch(() => {})}>取消本机计划</button>}<button className='nh-btn nh-btn-outline' disabled={busy} onClick={() => void onAction('exportPlan', { id: booking.id }).catch(() => {})}>导出计划（不含账号）</button></div>
    {booking.phase === 'uncertain' && <div><p className='nh-help-text'>结果不明时会锁定新预约。请先打开微信核对这次订单，再解除锁定。</p><button className='nh-btn nh-btn-outline' disabled={busy} onClick={() => { if (window.confirm('已在微信查看本次订单，并确认是否正在充电？确认后将再次只读核对平台状态，不会发起充电。')) void onAction('resolveUncertain', { id: booking.id, confirmedReviewed: true }).catch(() => {}); }}>已在微信核对，解除预约锁</button></div>}
  </section>;
}
function parseBookingResult(value: unknown) { return typeof value === 'string' ? value : ''; }

function SettingsTab({ state, busy, onAction }: { state: ChargeDashboardProps['state'], busy: boolean, onAction: ChargeDashboardProps['onAction'] }) {
  const [label, setLabel] = useState('');
  const [device, setDevice] = useState('');
  const [port, setPort] = useState('');

  const handleAddTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label || !device || !port) return;
    try {
      await onAction('saveTarget', { label, device, port });
      setLabel('');
      setDevice('');
      setPort('');
    } catch (err) {
      alert(err instanceof Error ? err.message : '保存失败');
    }
  };

  const handleDeleteTarget = async (id: string) => {
    if (window.confirm('确认删除此目标插座吗？')) {
      try { await onAction('deleteTarget', { id }); } catch (error) { alert(error instanceof Error ? error.message : '删除未完成'); }
    }
  };

  const [prefTime, setPrefTime] = useState(state.preferences.defaultTime);
  const [prefYuan, setPrefYuan] = useState((state.preferences.maxPrepayCents / 100).toFixed(2));
  const [prefDays, setPrefDays] = useState<number[]>(state.preferences.weekdays);

  const toggleDay = (day: number) => {
    if (prefDays.includes(day)) {
      setPrefDays(prefDays.filter(d => d !== day));
    } else {
      setPrefDays([...prefDays, day].sort());
    }
  };

  const handleSavePref = async (e: React.FormEvent) => {
    e.preventDefault();
    const cents = Math.round(parseFloat(prefYuan) * 100);
    if (!Number.isFinite(cents) || cents < 1 || cents > 200 || !prefDays.length) {
      alert('预扣金额必须在 0.01 到 2.00 元之间');
      return;
    }
    try {
      await onAction('savePreferences', {
        defaultTime: prefTime,
        weekdays: prefDays,
        maxPrepayCents: cents
      });
      alert('偏好已保存');
    } catch (err) {
      alert(err instanceof Error ? err.message : '保存失败');
    }
  };

  const daysMap = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  return (
    <div className='nh-tab-content'>
      <section className='nh-card'><h3>本机数据与备份</h3><p className='nh-text-sm nh-text-muted'>账号、设置与计划只保存在当前浏览器，不会自动同步。清除浏览器数据或换手机前，请导出加密备份并保留本机密码。</p><button className='nh-btn nh-btn-outline' disabled={busy} onClick={() => void onAction('exportBackup', {}).catch(() => {})}>导出加密备份</button><p className='nh-help-text'>分享给同学的是网站地址，每人自行创建本机空间和绑定自己的账号。</p></section>
      <div className='nh-card'>
        <div className='nh-card-header'>
          <h3>目标插座管理</h3>
        </div>
        {state.targets.length === 0 ? (
          <div className='nh-empty-state nh-text-sm'>暂无目标插座，请在下方添加以便预约。</div>
        ) : (
          <ul className='nh-target-list'>
            {state.targets.map(t => (
              <li key={t.id} className='nh-target-item'>
                <div className='nh-target-info'>
                  <strong>{t.label}</strong>
                  <span className='nh-text-sm nh-text-muted'>设备: {t.device} | 端口: {t.port}</span>
                </div>
                <button className='nh-icon-btn nh-text-danger' onClick={() => void handleDeleteTarget(t.id)} disabled={busy} aria-label={`删除${t.label}`}>
                  <Trash2 size={18} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={handleAddTarget} className='nh-form nh-mt-4'>
          <div className='nh-grid-3'>
            <input type='text' aria-label='充电点名称' maxLength={40} value={label} onChange={e => setLabel(e.target.value)} placeholder='名称，如宿舍楼下' required disabled={busy} />
            <input type='text' aria-label='8位设备号' pattern='[0-9]{8}' inputMode='numeric' maxLength={8} value={device} onChange={e => setDevice(e.target.value)} placeholder='8位设备号' required disabled={busy} />
            <input type='text' aria-label='插座号' pattern='[0-9]{1,2}' inputMode='numeric' maxLength={2} value={port} onChange={e => setPort(e.target.value)} placeholder='插座号，如06' required disabled={busy} />
          </div>
          <button type='submit' className='nh-btn nh-btn-outline nh-btn-full' disabled={busy}>
            <Plus size={16} /> 添加目标插座
          </button>
        </form>
      </div>

      <div className='nh-card'>
        <div className='nh-card-header'>
          <h3>偏好设置</h3>
        </div>
        <form onSubmit={handleSavePref} className='nh-form'>
          <div className='nh-form-group'>
            <label htmlFor='pref-time'>默认预约时间（北京时间）</label>
            <input id='pref-time' type='time' value={prefTime} onChange={e => setPrefTime(e.target.value)} required disabled={busy} />
          </div>
          <div className='nh-form-group'>
            <label htmlFor='pref-money'>最大预扣金额（元，最多2元）</label>
            <input id='pref-money' type='number' min='0.01' max='2.00' step='0.01' value={prefYuan} onChange={e => setPrefYuan(e.target.value)} required disabled={busy} />
          </div>
          <div className='nh-form-group'>
            <label>常用星期偏好</label>
            <div className='nh-days-group'>
              {daysMap.map((d, i) => (
                <button type='button' key={i} aria-pressed={prefDays.includes(i)} className={`nh-day-btn ${prefDays.includes(i) ? 'active' : ''}`} onClick={() => toggleDay(i)} disabled={busy}>
                  {d}
                </button>
              ))}
            </div>
            <div className='nh-help-text nh-text-sm nh-text-muted'>*星期偏好仅帮助快速选择，不会自动循环给公共插座开电</div>
          </div>
          <button type='submit' className='nh-btn nh-btn-primary' disabled={busy}>保存偏好</button>
        </form>
      </div>
    </div>
  );
}

function HistoryTab({ state, busy, onAction, now, parseResult, formatDate }: { state: ChargeDashboardProps['state'], busy: boolean, onAction: ChargeDashboardProps['onAction'], now: number, parseResult: (v: unknown) => string, formatDate: (iso: string) => string }) {
  const handleCancel = async (id: string) => {
    if (window.confirm('确认取消此预约吗？')) {
      try {
        await onAction('cancel', { id });
      } catch (err) {
        alert(err instanceof Error ? err.message : '取消失败');
      }
    }
  };

  const canCancel = (r: ChargeDashboardProps['state']['reservations'][0]) => {
    if (r.phase === 'planned') return true;
    if (r.phase !== 'queued' && r.phase !== 'scheduled') return false;
    try {
      const scheduledTime = new Date(r.scheduled_at).getTime();
      return (scheduledTime - now) > 30000;
    } catch {
      return false;
    }
  };

  return (
    <div className='nh-tab-content'>
      <div className='nh-card nh-history-card'>
        <div className='nh-card-header'>
          <h3>历史与计划</h3>
        </div>
        {state.reservations.length === 0 ? (
          <div className='nh-empty-state'>暂无历史记录</div>
        ) : (
          <div className='nh-history-list'>
            {state.reservations.map(r => {
              const target = state.targets.find(t => t.id === r.target_id);
              const targetName = target ? target.label : '未知设备';
              const cancelable = canCancel(r);
              return (
                <div key={r.id} className='nh-history-item'>
                  <div className='nh-history-header nh-flex-between'>
                    <strong>{targetName}</strong>
                    <span className={`nh-badge nh-phase-${r.phase}`}>{phaseNames[r.phase] ?? '正在核对'}</span>
                  </div>
                  <div className='nh-history-body nh-text-sm nh-text-muted'>
                    <p>计划执行: {formatDate(r.scheduled_at)}</p>
                    <p>创建时间: {formatDate(r.created_at)}</p>
                    <p>执行结果: {parseResult(r.result)}</p>
                  </div>
                  {cancelable && (
                    <div className='nh-history-actions'>
                      <button className='nh-btn nh-btn-outline nh-btn-sm nh-text-danger' onClick={() => handleCancel(r.id)} disabled={busy}>
                        取消本机计划
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
