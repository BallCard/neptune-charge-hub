"use client";

import React, { useState, useEffect, useRef } from "react";
import "./charge-workflow.css";
import type { WorkflowState, QrTarget, ChargeScheme, TargetQuote, BookingPhase, WorkflowBooking } from "@/lib/workflow-types";
import { workflowPhaseNames, tomorrowAt, formatBookingTime } from "@/lib/workflow-types";
import { Upload, Link as LinkIcon, Battery, Clock, Settings, History, AlertCircle, CheckCircle2, XCircle, Mail, Smartphone, RefreshCw, Download, Zap, Calendar, Camera, Info } from "lucide-react";

const mailStatusMap: Record<string, string> = {
  "queued": "等待发送",
  "sent": "已交给邮件服务器",
  "failed": "失败",
  "uncertain": "结果不明",
  "not-required": "无需发送"
};

export default function ChargeWorkflow(props: {
  state: WorkflowState;
  busy: boolean;
  onAction: (action: string, payload: Record<string, unknown>) => Promise<void>;
  onQrFile: (file: File) => Promise<void>;
}) {
  const { state, busy, onAction, onQrFile } = props;

  const [localError, setLocalError] = useState("");
  const [now, setNow] = useState(Date.now());

  // Step 1: Target
  const [showPaste, setShowPaste] = useState(false);
  const [pasteUrl, setPasteUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 2: Scheme
  const [selectedSchemeId, setSelectedSchemeId] = useState<string>("");

  // Step 3: Schedule
  const [scheduledStr, setScheduledStr] = useState<string>("");
  const [maxPrepayYuan, setMaxPrepayYuan] = useState<string>("2");
  const [confirmedPlug, setConfirmedPlug] = useState(false);

  // Config forms
  const [showConfig, setShowConfig] = useState(!state.profile.accountBound || !state.profile.mailConfigured);
  const [accountUrl, setAccountUrl] = useState("");
  const [editAccount, setEditAccount] = useState(false);
  const [mailConfig, setMailConfig] = useState({ recipient: "", sender: "", host: "smtp.qq.com", port: 465, password: "" });

  // Init Time
  useEffect(() => {
    try {
      const tomorrowIso = tomorrowAt("06:00", Date.now());
      const d = new Date(tomorrowIso);
      const bjTimeMs = d.getTime() + 8 * 3600000;
      const bjDateStr = new Date(bjTimeMs).toISOString().slice(0, 16);
      setScheduledStr(bjDateStr);
    } catch (e) {
      // fallback
    }
  }, []);

  // Tick 15s
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);

  // Update selected scheme if quote changes and current selection is invalid
  useEffect(() => {
    if (state.quote?.schemes && state.quote.schemes.length > 0) {
      if (!selectedSchemeId || !state.quote.schemes.find(s => s.id === selectedSchemeId)) {
        setSelectedSchemeId(state.quote.schemes[0].id);
      }
    }
  }, [state.quote, selectedSchemeId]);

  const doAction = async (action: string, payload: Record<string, unknown>) => {
    setLocalError("");
    try {
      await onAction(action, payload);
      return true;
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : "操作未完成，请核对输入。");
      return false;
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLocalError("");
    try {
      await onQrFile(file);
    } catch (err: unknown) {
      setLocalError(err instanceof Error ? err.message : "二维码识别失败");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handlePasteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pasteUrl.trim()) return;
    if (await doAction("setTarget", { url: pasteUrl.trim() })) { setPasteUrl(""); setShowPaste(false); }
  };

  const isQuoteValid = !!(state.target && state.quote && state.target.device === state.quote.device && state.target.port === state.quote.port);
  const selectedScheme = state.quote?.schemes.find(s => s.id === selectedSchemeId);

  const activePhases = ["scheduled", "waiting", "checking", "submitting", "pending", "uncertain"];
  const hasActiveBooking = state.bookings.some(b => activePhases.includes(b.phase));

  const canReserve =
    state.executor.connected &&
    state.executor.exactAlarm &&
    state.executor.notifications &&
    state.profile.accountBound &&
    state.profile.mailConfigured &&
    isQuoteValid &&
    state.quote?.available &&
    selectedSchemeId &&
    confirmedPlug &&
    !hasActiveBooking &&
    scheduledStr;

  const handleReserve = async () => {
    if (!canReserve || !selectedScheme) return;
    let prepayVal = Math.round(parseFloat(maxPrepayYuan) * 100);
    if (isNaN(prepayVal) || prepayVal < 1 || prepayVal > 1000) {
      setLocalError("预扣金额需在0.01元至10.00元之间");
      return;
    }
    try {
      const isoTime = new Date(scheduledStr + ":00+08:00").toISOString();
      const success = await doAction("reserve", {
        idempotencyKey: crypto.randomUUID(),
        target: state.target,
        schemeId: selectedSchemeId,
        quoteFingerprint: state.quote!.fingerprint,
        scheduledAt: isoTime,
        confirmedPlug: true,
        maxPrepayCents: prepayVal
      });
      if (success) setConfirmedPlug(false);
    } catch (e: unknown) {
      setLocalError(e instanceof Error ? e.message : "预约参数格式不正确。");
    }
  };

  const handleCancel = async (booking: WorkflowBooking) => {
    const diff = new Date(booking.scheduledAt).getTime() - now;
    if (booking.phase === "scheduled" && diff > 30000) {
      if (window.confirm("确定要取消这个预约吗？不自动请求退款。")) {
        await doAction("cancel", { id: booking.id });
      }
    }
  };

  const handleAccountConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountUrl) return;
    if (await doAction("configureAccount", { url: accountUrl })) { setAccountUrl(""); setEditAccount(false); }
  };

  const handleMailConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await doAction("configureMail", mailConfig)) setMailConfig(prev => ({ ...prev, password: "" }));
  };

  const getBjTimeMs = (offsetMs: number) => {
    return new Date(now + offsetMs + 8 * 3600000).toISOString().slice(0, 16);
  };

  return (
    <div className="cw-container">
      <header className="cw-header">
        <div className="cw-header-title">
          <Zap className="cw-icon-primary" size={28} />
          <h1>今晚接好，明早开电</h1>
        </div>
        <span className="cw-badge-local">本机保存</span>
      </header>

      <div className="cw-layout">
        <main className="cw-main-flow">

          {(state.error || localError) && (
            <div className="cw-alert cw-alert-error" role="alert">
              <AlertCircle size={20} />
              <div>
                {state.error && <p>{state.error}</p>}
                {localError && <p>{localError}</p>}
              </div>
            </div>
          )}

          <div className="cw-card cw-executor-card">
            <div className="cw-card-header">
              <Smartphone size={20} />
              <h2>执行环境能力</h2>
            </div>
            <div className="cw-card-body">
              <p className="cw-text-muted">{state.executor.detail}</p>
              <div className="cw-executor-actions">
                {!state.executor.connected && (
                  <a href="/downloads/neptune-local-assistant.apk" className="cw-btn cw-btn-outline" target="_blank" rel="noreferrer">
                    <Download size={16} /> 下载安卓本机助手
                  </a>
                )}
                {!state.executor.exactAlarm && state.executor.connected && (
                  <button className="cw-btn cw-btn-outline" disabled={busy} onClick={() => doAction("openAlarmSettings", {})}>开启精确闹钟</button>
                )}
                {!state.executor.notifications && state.executor.connected && (
                  <button className="cw-btn cw-btn-outline" disabled={busy} onClick={() => doAction("openNotificationSettings", {})}>开启通知权限</button>
                )}
                {state.executor.connected && (
                  <button className="cw-btn cw-btn-text" disabled={busy} onClick={() => doAction("openBatterySettings", {})} title="确保后台运行和联网">电池与后台设置</button>
                )}
              </div>
              {!state.executor.connected && state.executor.kind === "ios" && (
                <p className="cw-text-sm cw-text-warn">iPhone执行入口尚未验证。</p>
              )}
            </div>
          </div>

          <div className="cw-step-card">
            <div className="cw-step-header">
              <div className="cw-step-number">1</div>
              <h2>识别插座二维码</h2>
            </div>
            <div className="cw-step-body">
              {state.target ? (
                <div className="cw-target-info">
                  <CheckCircle2 className="cw-icon-success" size={24} />
                  <div>
                    <strong>设备: {state.target.device}</strong>
                    <p>插座端口: {state.target.port} {state.target.label ? `(${state.target.label})` : ""}</p>
                  </div>
                  <button className="cw-btn cw-btn-icon" disabled={busy} onClick={() => doAction("setTarget", { url: "" })} title="重新选择">
                    <XCircle size={20} />
                  </button>
                </div>
              ) : (
                <div className="cw-upload-area">
                  <input type="file" id="qr-upload" className="cw-hidden-input" accept="image/png,image/jpeg,image/webp" onChange={handleFileChange} disabled={busy} ref={fileInputRef} />
                  <label htmlFor="qr-upload" className={`cw-upload-label ${busy ? 'cw-disabled' : ''}`}>
                    <Camera size={32} />
                    <span>拍照 / 选择二维码图片</span>
                  </label>
                  <div className="cw-paste-toggle">
                    <button className="cw-btn cw-btn-text" disabled={busy} onClick={() => setShowPaste(!showPaste)}>
                      <LinkIcon size={16} /> {showPaste ? "收起链接输入" : "粘贴二维码链接"}
                    </button>
                  </div>
                  {showPaste && (
                    <form onSubmit={handlePasteSubmit} className="cw-paste-form">
                      <input type="url" aria-label="二维码链接" className="cw-input" placeholder="https://..." value={pasteUrl} onChange={e => setPasteUrl(e.target.value)} disabled={busy} required />
                      <button type="submit" className="cw-btn cw-btn-secondary" disabled={busy}>解析</button>
                    </form>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="cw-step-card">
            <div className="cw-step-header">
              <div className="cw-step-number">2</div>
              <h2>选择充电方案</h2>
            </div>
            <div className="cw-step-body">
              {!state.target ? (
                <p className="cw-text-muted">请先完成第一步。</p>
              ) : !isQuoteValid ? (
                <div className="cw-quote-action">
                  <p className="cw-text-muted">需核对账号与插座实时状态。</p>
                  <button className="cw-btn cw-btn-secondary" disabled={busy || !state.profile.accountBound} onClick={() => doAction("inspectTarget", {})}>
                    <RefreshCw size={16} /> 配置账号后核对插座
                  </button>
                </div>
              ) : (
                <div className="cw-schemes-list">
                  <div className="cw-quote-summary">
                    <span className="cw-badge-status">{state.quote?.businessOpen ? "营业中" : "尚未营业"} / {state.quote?.available ? "插座空闲" : "不可用"}</span>
                    <span>账户余额: {((state.quote?.balanceCents || 0) / 100).toFixed(2)} 元</span>
                  </div>
                  <p className="cw-text-sm cw-text-muted">核对于 {state.quote && formatBookingTime(state.quote.checkedAt)}（北京时间）</p>
                  <button className="cw-btn cw-btn-text" disabled={busy} onClick={() => doAction("inspectTarget", {})}><RefreshCw size={16} /> 重新核对插座</button>
                  {state.quote?.schemes.map(s => (
                    <label key={s.id} className={`cw-scheme-radio ${selectedSchemeId === s.id ? 'cw-selected' : ''}`}>
                      <input type="radio" name="scheme" value={s.id} checked={selectedSchemeId === s.id} onChange={(e) => setSelectedSchemeId(e.target.value)} disabled={busy} />
                      <div className="cw-scheme-content">
                        <strong>{s.title}</strong>
                        <p>{s.description}</p>
                        <div className="cw-scheme-meta">
                          <span>最长 {s.maxMinutes} 分钟</span>
                          <span>预扣: {(s.prepayCents / 100).toFixed(2)} 元</span>
                        </div>
                      </div>
                    </label>
                  ))}
                  <p className="cw-text-sm cw-text-muted"><Info size={14} /> 充满可提前停止，不承诺充满或到时一定结束。</p>
                </div>
              )}
            </div>
          </div>

          <div className="cw-step-card">
            <div className="cw-step-header">
              <div className="cw-step-number">3</div>
              <h2>预约时间与启动</h2>
            </div>
            <div className="cw-step-body">
               <div className="cw-form-row">
                 <div className="cw-input-group">
                   <label htmlFor="cw-time" className="cw-label">北京时间</label>
                   <input id="cw-time" type="datetime-local" className="cw-input cw-input-lg" value={scheduledStr} onChange={e => setScheduledStr(e.target.value)} disabled={busy} min={getBjTimeMs(60000)} max={getBjTimeMs(48 * 3600000)} required />
                 </div>
                 <div className="cw-input-group">
                   <label htmlFor="cw-cap" className="cw-label">预扣上限 (元)</label>
                   <input id="cw-cap" type="number" className="cw-input cw-input-lg" value={maxPrepayYuan} onChange={e => setMaxPrepayYuan(e.target.value)} disabled={busy} min="0.01" max="10.00" step="0.01" required />
                 </div>
               </div>

               <label className="cw-checkbox-label cw-mt-4">
                 <input type="checkbox" checked={confirmedPlug} onChange={e => setConfirmedPlug(e.target.checked)} disabled={busy} />
                 <span className="cw-checkbox-text">我的车辆和充电器已接好，设备和插座无误。</span>
               </label>

               {confirmedPlug && isQuoteValid && selectedScheme && scheduledStr && (
                 <div className="cw-review-box">
                   <h4>预约信息核对</h4>
                   <ul>
                     <li><strong>插座:</strong> {state.target?.device} - {state.target?.port}</li>
                     <li><strong>方案:</strong> {selectedScheme.title}</li>
                     <li><strong>日期:</strong> {scheduledStr.replace('T', ' ')}</li>
                     <li><strong>金额上限:</strong> {parseFloat(maxPrepayYuan).toFixed(2)} 元</li>
                     <li><strong>通知接收:</strong> {state.profile.recipient || "未配置"}</li>
                   </ul>
                 </div>
               )}

               <button className="cw-btn cw-btn-primary cw-btn-block cw-mt-4" disabled={busy || !canReserve} onClick={handleReserve}>
                 已接好，预约 {scheduledStr ? scheduledStr.split("T")[1] : "明天06:00"}
               </button>
               {hasActiveBooking && <p className="cw-text-warn cw-text-center cw-mt-2">已有进行中的预约，需等待其完成或取消。</p>}
            </div>
          </div>

        </main>

        <aside className="cw-sidebar">

          <div className="cw-card">
            <button type="button" className="cw-card-header cw-clickable cw-config-toggle" aria-expanded={showConfig} onClick={() => setShowConfig(!showConfig)}>
              <div className="cw-header-left">
                <Settings size={20} />
                <h2>账号与通知设置</h2>
              </div>
              <span className="cw-text-sm">{showConfig ? "收起" : "展开"}</span>
            </button>

            {showConfig && (
              <div className="cw-card-body cw-config-body">
                {!state.executor.connected && <p className="cw-text-sm cw-text-muted">请在本机助手中配置账号和邮箱，信息不会上传到网站。</p>}
                <fieldset className="cw-fieldset" disabled={busy || !state.executor.connected}>
                  <legend>付款账号授权</legend>
                  {state.profile.accountBound && !editAccount ? (
                    <div><div className="cw-success-text"><CheckCircle2 size={16}/> 已配置账号</div><button type="button" className="cw-btn cw-btn-text" disabled={busy || hasActiveBooking} onClick={() => setEditAccount(true)}>更换账号授权</button></div>
                  ) : (
                    <form onSubmit={handleAccountConfig}>
                      <p className="cw-text-sm cw-text-muted cw-mb-2">请在微信中打开付款页，复制完整链接导入一次。</p>
                      <label htmlFor="cw-account-url" className="cw-label">本人付款页完整链接</label>
                      <input id="cw-account-url" type="password" autoComplete="off" className="cw-input cw-mb-2" placeholder="粘贴完整的链接..." value={accountUrl} onChange={e => setAccountUrl(e.target.value)} disabled={busy} required />
                      <button type="submit" className="cw-btn cw-btn-secondary cw-btn-block" disabled={busy}>导入授权</button>
                    </form>
                  )}
                </fieldset>

                <fieldset className="cw-fieldset cw-mt-4" disabled={busy || !state.executor.connected}>
                  <legend>邮件通知配置</legend>
                  {state.profile.mailConfigured && (
                    <div className="cw-success-text cw-mb-2"><CheckCircle2 size={16}/> 当前接收: {state.profile.recipient}</div>
                  )}
                  <form onSubmit={handleMailConfig}>
                    <div className="cw-form-row">
                      <div className="cw-input-group">
                         <label htmlFor="cw-recipient" className="cw-label">收件人</label>
                         <input id="cw-recipient" type="email" className="cw-input" value={mailConfig.recipient} onChange={e => setMailConfig({...mailConfig, recipient: e.target.value})} disabled={busy} required />
                      </div>
                      <div className="cw-input-group">
                         <label htmlFor="cw-sender" className="cw-label">发件人</label>
                         <input id="cw-sender" type="email" className="cw-input" value={mailConfig.sender} onChange={e => setMailConfig({...mailConfig, sender: e.target.value})} disabled={busy} required />
                      </div>
                    </div>
                    <div className="cw-form-row">
                      <div className="cw-input-group">
                         <label htmlFor="cw-smtp-host" className="cw-label">SMTP 服务器</label>
                         <input id="cw-smtp-host" type="text" className="cw-input" value={mailConfig.host} onChange={e => setMailConfig({...mailConfig, host: e.target.value})} disabled={busy} required />
                      </div>
                      <div className="cw-input-group">
                         <label htmlFor="cw-smtp-port" className="cw-label">加密端口</label>
                         <input id="cw-smtp-port" type="number" className="cw-input" value={465} readOnly disabled={busy} required />
                      </div>
                    </div>
                    <div className="cw-input-group cw-mt-2">
                       <label htmlFor="cw-smtp-secret" className="cw-label">SMTP 授权码 (非邮箱密码)</label>
                       <input id="cw-smtp-secret" type="password" autoComplete="off" className="cw-input" value={mailConfig.password} onChange={e => setMailConfig({...mailConfig, password: e.target.value})} disabled={busy} required />
                    </div>
                    <p className="cw-text-sm cw-text-muted cw-mt-2">配置加密存本机。</p>
                    <button type="submit" className="cw-btn cw-btn-secondary cw-btn-block cw-mt-2" disabled={busy}>保存通知配置</button>
                  </form>
                </fieldset>

                <button className="cw-btn cw-btn-text cw-btn-block cw-mt-4" disabled={busy || !state.executor.connected} onClick={() => doAction("exportBackup", {})}>
                  <Download size={16}/> 导出配置加密备份
                </button>
              </div>
            )}
          </div>

          <div className="cw-card cw-records-card">
            <div className="cw-card-header">
              <div className="cw-header-left">
                <History size={20} />
                <h2>预约记录</h2>
              </div>
              <button className="cw-btn cw-btn-icon" disabled={busy} onClick={() => doAction("refresh", {})} title="刷新">
                <RefreshCw size={18} />
              </button>
            </div>
            <div className="cw-card-body cw-records-list">
              {state.bookings.length === 0 ? (
                <p className="cw-text-muted cw-text-center">暂无记录</p>
              ) : (
                state.bookings.map(b => {
                  const isCancelable = b.phase === "scheduled" && (new Date(b.scheduledAt).getTime() - now > 30000);
                  return (
                    <div key={b.id} className="cw-record-item">
                      <div className="cw-record-head">
                        <span className={`cw-phase-badge cw-phase-${b.phase}`}>{workflowPhaseNames[b.phase] || b.phase}</span>
                        <span className="cw-record-time">{formatBookingTime(b.scheduledAt)}</span>
                      </div>
                      <div className="cw-record-details">
                        <p>{b.device} - {b.port} | {b.schemeTitle}</p>
                        {b.result && <p className="cw-record-result">{b.result}</p>}
                        <div className="cw-record-meta">
                           <span>通知: {mailStatusMap[b.mailStatus] || b.mailStatus}</span>
                           {b.phase === "uncertain" && <button className="cw-btn cw-btn-outline cw-btn-sm" disabled={busy || !state.executor.connected} onClick={async () => { if (window.confirm("确认你已在微信核对上次订单与扣款，并且当前没有本人充电中的订单？旧请求不会重发。")) await doAction("reviewUncertain", {id:b.id,confirmedReview:true}); }}>已在微信核对</button>}
                           {b.mailStatus === "failed" && <button className="cw-btn cw-btn-outline cw-btn-sm" disabled={busy || !state.executor.connected} onClick={() => doAction("retryMail", {id:b.id})}>重试结果邮件</button>}
                           {isCancelable && (
                             <button className="cw-btn cw-btn-danger cw-btn-sm" disabled={busy} onClick={() => handleCancel(b)}>取消</button>
                           )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </aside>
      </div>
    </div>
  );
}
