"use client";
import React, { useState, useEffect, useMemo } from 'react';
import './charge-workflow.css';
import { Camera, Settings, AlertTriangle, X, Smartphone, WifiOff } from 'lucide-react';
import {
  type BookingPhase, type WorkflowBooking, type WorkflowState,
  workflowPhaseNames, tomorrowAt, formatBookingTime
} from '@/lib/workflow-types';

export default function ChargeWorkflow(props: {
  state: WorkflowState;
  busy: boolean;
  onAction: (action: string, payload: Record<string, unknown>) => Promise<void>;
  onQrFile: (file: File) => Promise<void>;
}) {
  const { state, busy } = props;
  const [localError, setLocalError] = useState("");

  const [manualUrl, setManualUrl] = useState("");
  const [manualNum, setManualNum] = useState("");

  const [accountUrl, setAccountUrl] = useState("");
  const [editingAccount, setEditingAccount] = useState(false);

  const [selectedSchemeId, setSelectedSchemeId] = useState("");

  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");

  const [confirmedPlug, setConfirmedPlug] = useState(false);
  const [maxPrepayInput, setMaxPrepayInput] = useState("2");

  const [uncertainChecks, setUncertainChecks] = useState<Record<string, boolean>>({});

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!scheduleDate && !scheduleTime) {
      const iso = new Date(Date.parse(tomorrowAt('06:00', now)) + 8 * 3600_000).toISOString().split('T');
      setScheduleDate(iso[0]);
      setScheduleTime(iso[1].substring(0, 5));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setConfirmedPlug(false);
    if (state.quote && state.quote.schemes.length > 0) {
      if (!state.quote.schemes.find(s => s.id === selectedSchemeId)) {
        setSelectedSchemeId(state.quote.schemes[0].id);
      }
    } else {
      setSelectedSchemeId("");
    }
  }, [state.quote?.fingerprint, state.target?.device, state.target?.port, selectedSchemeId, scheduleDate, scheduleTime, maxPrepayInput]);

  const wrapAction = async (action: string, payload: Record<string, unknown>) => {
    setLocalError("");
    try {
      await props.onAction(action, payload);
      return true;
    } catch (e: unknown) {
      setLocalError(e instanceof Error ? e.message : "操作失败");
      return false;
    }
  };

  const handleQrUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLocalError("");
    try {
      await props.onQrFile(file);
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : "二维码识别失败");
    } finally {
      e.target.value = '';
    }
  };

  const handleBindAccount = async () => {
    setLocalError("");
    try {
      await props.onAction("configureAccount", { url: accountUrl });
      setAccountUrl("");
      setEditingAccount(false);
    } catch (e: unknown) {
      setLocalError(e instanceof Error ? e.message : "授权失败");
    }
  };

  const onReserve = async () => {
    if (!canReserve || !state.target || !state.quote || !selectedSchemeId) return;
    setLocalError("");
    try {
      const scheduledAt = new Date(`${scheduleDate}T${scheduleTime}:00+08:00`).toISOString();
      await props.onAction("reserve", {
        idempotencyKey: crypto.randomUUID(),
        target: state.target,
        schemeId: selectedSchemeId,
        quoteFingerprint: state.quote.fingerprint,
        scheduledAt,
        confirmedPlug,
        maxPrepayCents
      });
      setConfirmedPlug(false);
    } catch (e: unknown) {
      setLocalError(e instanceof Error ? e.message : "预约失败");
    }
  };

  const isQuoteMatching = state.quote && state.target && state.quote.device === state.target.device && state.quote.port === state.target.port;

  const isValidTime = useMemo(() => {
    if (!scheduleDate || !scheduleTime) return false;
    const t = new Date(`${scheduleDate}T${scheduleTime}:00+08:00`).getTime();
    return t >= now + 60_000 && t <= now + 48 * 3600_000;
  }, [scheduleDate, scheduleTime, now]);

  const reserveButtonText = useMemo(() => {
    if (!scheduleDate || !scheduleTime) return "预约开电";
    const tmr = new Date(now + 8 * 3600_000 + 24 * 3600_000).toISOString().slice(0, 10);
    const isTomorrow = scheduleDate === tmr;
    if (isTomorrow) {
      return `预约 明天 ${scheduleTime} 开电`;
    } else {
      return `预约 ${scheduleDate.slice(5).replace('-', '月')}日 ${scheduleTime} 开电`;
    }
  }, [scheduleDate, scheduleTime, now]);

  const activePhases: BookingPhase[] = ["scheduled", "waiting", "checking", "submitting", "pending", "uncertain"];
  const hasActiveBooking = state.bookings.some(b => activePhases.includes(b.phase));
  const selectedScheme = state.quote?.schemes.find(s => s.id === selectedSchemeId);
  const maxPrepayCents = /^\d+(\.\d{1,2})?$/.test(maxPrepayInput) ? Math.round(Number(maxPrepayInput) * 100) : NaN;

  const canReserve = !!(
    state.executor.connected &&
    state.executor.exactAlarm &&
    state.executor.notifications &&
    state.profile.accountBound &&
    isQuoteMatching &&
    state.quote?.available &&
    selectedScheme &&
    state.quote.balanceCents >= Math.max(200, selectedScheme.prepayCents) &&
    maxPrepayCents >= selectedScheme.prepayCents && maxPrepayCents <= 1000 &&
    !hasActiveBooking &&
    confirmedPlug &&
    isValidTime &&
    !busy
  );

  const renderBooking = (booking: WorkflowBooking, compact: boolean = false) => {
    const isCancellable = booking.phase === "scheduled" && (new Date(booking.scheduledAt).getTime() - now > 30000);
    const isUncertain = booking.phase === "uncertain";
    const isTerminal = ["confirmed", "already-charging", "failed", "uncertain", "reviewed", "rejected", "missed", "scheduling-failed"].includes(booking.phase);
    const notificationFailed = booking.notificationStatus === "failed";

    return (
      <div key={booking.id} className={`cw-booking-card ${compact ? 'cw-booking-compact' : ''} cw-mt-8`}>
        <div className="cw-row cw-justify-between">
          <strong className="cw-text-primary">{workflowPhaseNames[booking.phase]}</strong>
          <span className="cw-text-xs cw-text-muted">{formatBookingTime(booking.scheduledAt)}</span>
        </div>
        <div className="cw-text-sm cw-mt-4">
          {booking.device}-{booking.port} | {booking.schemeTitle}
        </div>
        {booking.result && <div className="cw-text-xs cw-text-muted cw-mt-4">{booking.result}</div>}

        {isUncertain && (
          <div className="cw-mt-8">
            <label className="cw-checkbox-row">
              <input type="checkbox" disabled={busy} checked={!!uncertainChecks[booking.id]} onChange={e => setUncertainChecks(prev => ({ ...prev, [booking.id]: e.target.checked }))} />
              <span className="cw-text-sm">已在官方平台查明结果</span>
            </label>
            <button className="cw-btn-primary cw-w-full cw-mt-8" disabled={busy || !uncertainChecks[booking.id]} onClick={() => {
              if (window.confirm('旧请求不会再次发送，确定已核对？')) wrapAction('reviewUncertain', { id: booking.id, confirmedReview: true });
            }}>确认核对完毕</button>
          </div>
        )}

        {booking.notificationStatus === 'shown' && <p className="cw-text-xs cw-text-muted">已提交系统提醒</p>}
        {booking.notificationStatus === 'failed' && <p className="cw-text-xs cw-text-warning">手机通知未发出，充电结果见上方</p>}
        <div className="cw-booking-actions">
          {isCancellable && (
            <button className="cw-btn-secondary" disabled={busy} onClick={() => {
              if (window.confirm('确定取消预约？')) wrapAction('cancel', { id: booking.id });
            }}>取消</button>
          )}
          {isTerminal && notificationFailed && (
            <button className="cw-btn-secondary" disabled={busy} onClick={() => wrapAction('retryNotification', { id: booking.id })}>重试通知</button>
          )}
        </div>
      </div>
    );
  };

  const displayError = localError || state.error;

  return (
    <div className="cw-app">
      <header className="cw-header">
        <div className="cw-header-top">
          <h1 className="cw-title">晨充</h1>
          <span className="cw-subtitle">今晚接好，明早开电</span>
          <button type="button" className="cw-badge cw-about" aria-label="查看使用场景" onClick={() => window.dispatchEvent(new Event('neptune-show-welcome'))}>使用介绍</button>
        </div>
        <div className="cw-status-bar">
          {state.executor.connected ? <Smartphone className="cw-icon-sm" /> : <WifiOff className="cw-icon-sm" />}
          <span>{state.executor.connected ? '本机保存 · 已连接' : '网页预览 · 尚未启用后台预约'}</span>
        </div>
      </header>

      {displayError && (
        <div className="cw-alert" role="alert">
          <AlertTriangle className="cw-icon-sm" />
          <span className="cw-flex-1">{displayError}</span>
          {localError && <button aria-label="关闭错误提示" onClick={() => setLocalError("")}><X className="cw-icon-sm" /></button>}
        </div>
      )}

      <section className="cw-section cw-socket-section">
        <div className="cw-section-header">插座</div>
        <div className="cw-row">
          <label className="cw-btn-secondary cw-upload" title="上传插座二维码">
            <Camera className="cw-icon" />
            上传二维码
            <input className="cw-file-input" aria-label="上传插座二维码" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={handleQrUpload}/>
          </label>
          <div className="cw-flex-1 cw-text-sm">
            {state.target ? <strong className="cw-text-primary">{state.target.device}<br/>{state.target.port}号插座</strong> : <span className="cw-text-muted">或直接导入付款页链接</span>}
          </div>
        </div>
        <details className="cw-details">
          <summary>手动输入插座信息</summary>
          <div className="cw-fold-content">
            <div className="cw-row">
              <input aria-label="官方二维码链接" disabled={busy} type="text" placeholder="官方二维码链接" className="cw-input cw-flex-1" value={manualUrl} onChange={e => setManualUrl(e.target.value)} />
              <button className="cw-btn-secondary" disabled={busy || !manualUrl} onClick={async () => { if(await wrapAction('setTarget', { url: manualUrl })) setManualUrl(""); }}>确定</button>
            </div>
            <div className="cw-row">
              <input aria-label="标签上的10位插座编号" disabled={busy} inputMode="numeric" maxLength={10} type="text" placeholder="标签上的10位编号" className="cw-input cw-flex-1" value={manualNum} onChange={e => setManualNum(e.target.value)} />
              <button className="cw-btn-secondary" disabled={busy || !manualNum} onClick={async () => { if(await wrapAction('setTarget', { number: manualNum })) setManualNum(""); }}>确定</button>
            </div>
          </div>
        </details>
      </section>

      <section className="cw-section cw-auth-section">
        <div className="cw-section-header">付款账号授权</div>
        {state.profile.accountBound && !editingAccount ? (
          <div className="cw-row cw-justify-between">
            <span className="cw-text-sm cw-text-primary">已保存在本机</span>
            <button className="cw-btn-text" disabled={busy || !state.executor.connected} onClick={() => setEditingAccount(true)}>更换</button>
          </div>
        ) : (
          <div className="cw-row">
            <input aria-label="本人付款页授权链接" disabled={busy || !state.executor.connected} type="password" autoComplete="off" placeholder="粘贴付款页完整链接" className="cw-input cw-flex-1" value={accountUrl} onChange={e => setAccountUrl(e.target.value)} />
            <button className="cw-btn-primary" disabled={busy || !state.executor.connected || !accountUrl} onClick={handleBindAccount}>保存</button>
          </div>
        )}
        <details className="cw-details">
          <summary aria-label="如何获取付款链接？">授权教程</summary>
          <div className="cw-fold-content cw-text-xs cw-text-muted">
            <ol><li>在微信扫一扫，或从相册识别插座二维码，进入尼普顿。</li><li>等本人付款页显示余额与方案，点右上角“…” → “复制链接”。</li><li>把完整链接粘贴到这里，点保存。首次仅核对账号与插座，不发起付款。</li></ol>
            <p>插座二维码本身没有付款身份，不能代替授权；若链接缺少身份信息，请回微信重新进入付款页。导入后以付款页的插座为准，再核对编号。</p>
            <p>完整链接包含本人付款授权，只存本机，请勿分享给他人。</p>
          </div>
        </details>
      </section>

      <section className="cw-section">
        <div className="cw-section-header">方案 (核对后预约)</div>
        {state.target && state.profile.accountBound ? (
          isQuoteMatching ? (
            <div className="cw-flex-col">
              <div className="cw-row cw-justify-between cw-text-sm">
                <span>余额: <strong className="cw-text-primary">{(state.quote!.balanceCents / 100).toFixed(2)}</strong> 元</span>
                <button className="cw-btn-text" disabled={busy || !state.executor.connected} onClick={() => wrapAction('inspectTarget', {})}>重新核对</button>
              </div>
              {!state.quote!.available && <div className="cw-text-warning cw-text-sm cw-mt-4">插座暂不可用，请在微信核对</div>}
              <select aria-label="充电方案" disabled={busy} className="cw-input cw-mt-8 cw-w-full" value={selectedSchemeId} onChange={e => setSelectedSchemeId(e.target.value)}>
                {state.quote!.schemes.map(s => (
                  <option key={s.id} value={s.id}>{s.title}</option>
                ))}
              </select>
              {selectedScheme && <span className="cw-text-sm cw-text-muted cw-mt-4">预扣 {(selectedScheme.prepayCents / 100).toFixed(2)} 元 · {selectedScheme.description}</span>}
            </div>
          ) : (
            <button className="cw-btn-secondary cw-w-full" disabled={busy || !state.executor.connected} onClick={() => wrapAction('inspectTarget', {})}>核对账号与插座</button>
          )
        ) : (
          <div className="cw-text-sm cw-text-muted">请先识别插座并完成账号授权</div>
        )}
      </section>

      <section className="cw-section">
        <div className="cw-section-header">预约开电 (北京时间)</div>
        <div className="cw-row">
          <input aria-label="开电日期（北京时间）" disabled={busy} type="date" className="cw-input cw-flex-1" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} />
          <input aria-label="开电时间（北京时间）" disabled={busy} type="time" className="cw-input cw-flex-1" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} />
        </div>
        <label className="cw-checkbox-row">
          <input disabled={busy} type="checkbox" checked={confirmedPlug} onChange={e => setConfirmedPlug(e.target.checked)} />
          <span className={`cw-text-sm ${confirmedPlug ? 'cw-text-primary' : ''}`}>车辆已接好，设备与插座编号无误</span>
        </label>

        {state.executor.connected && (!state.executor.exactAlarm || !state.executor.notifications) && (
          <div className="cw-row cw-mt-8 cw-text-sm cw-text-warning cw-justify-between">
            <span>缺少开电必备权限</span>
            <button className="cw-btn-text" disabled={busy} onClick={() => {
              if (!state.executor.notifications) wrapAction('openNotificationSettings', {});
              else wrapAction('openAlarmSettings', {});
            }}>去开启</button>
          </div>
        )}

        <span className="cw-text-sm cw-text-muted">结果用手机通知，无需填写邮箱</span>
        <button className="cw-btn-primary cw-w-full cw-btn-large" disabled={!canReserve} onClick={onReserve}>
          {reserveButtonText}
        </button>
        {!state.executor.connected && (
          <div className="cw-text-xs cw-text-muted cw-text-center">手机网页不能后台开电；请在安卓本机助手预约</div>
        )}
      </section>

      {state.bookings.length > 0 && (
        <section className="cw-section">
          <div className="cw-section-header">最新记录</div>
          {renderBooking(state.bookings[0], false)}
          {state.bookings.length > 1 && (
            <details className="cw-details cw-mt-8">
              <summary>更多记录</summary>
              <div className="cw-fold-content">
                {state.bookings.slice(1).map(b => renderBooking(b, true))}
              </div>
            </details>
          )}
        </section>
      )}

      <section className="cw-section">
        <details className="cw-details">
          <summary><Settings className="cw-icon-sm cw-mr-4" /> 高级与设置</summary>
          <div className="cw-fold-content">
            <div className="cw-setting-item cw-text-sm">
              <span>单次金额上限 (元)</span>
              <input aria-label="单次预扣上限（元）" disabled={busy} type="number" min="0.01" max="10" step="0.01" className="cw-input cw-w-24"
                value={maxPrepayInput} onChange={e => setMaxPrepayInput(e.target.value)} />
            </div>
            <div className="cw-setting-actions cw-mt-8">
              <button className="cw-btn-secondary" disabled={busy || !state.executor.connected} onClick={() => wrapAction('openNotificationSettings', {})}>通知权限</button>
              <button className="cw-btn-secondary" disabled={busy || !state.executor.connected} onClick={() => wrapAction('openAlarmSettings', {})}>闹钟权限</button>
              <button className="cw-btn-secondary" disabled={busy || !state.executor.connected} onClick={() => wrapAction('openBatterySettings', {})}>后台运行</button>
            </div>
            <div className="cw-text-xs cw-text-muted cw-mt-8">
              锁屏后台需联网，关机或强制停止应用后无法执行。加密配置备份不含预约。
            </div>
            {state.executor.connected && (
              <div className="cw-setting-actions cw-mt-8">
                <button className="cw-btn-secondary" disabled={busy} onClick={() => wrapAction('exportBackup', {})}>导出配置</button>
                <button className="cw-btn-secondary" disabled={busy} onClick={() => wrapAction('restoreBackup', {})}>恢复配置</button>
              </div>
            )}
          </div>
        </details>
      </section>
    </div>
  );
}
