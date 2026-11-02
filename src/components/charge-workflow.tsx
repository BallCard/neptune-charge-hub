"use client";
import React, { useState, useEffect, useMemo, useRef } from "react";
import "./charge-workflow.css";
import "./gemini-ui.css";
import { GeminiHeader, GeminiNavigation } from "./gemini-shell";
import {
  Zap,
  MapPin,
  Clock,
  User,
  HelpCircle,
  AlertTriangle,
  CheckCircle2,
  X,
  ExternalLink,
  ChevronRight,
  ShieldCheck,
} from "lucide-react";
import {
  type BookingPhase,
  type WorkflowBooking,
  type WorkflowState,
  type QrTarget,
  workflowPhaseNames,
  tomorrowAt,
  formatBookingTime,
} from "@/lib/workflow-types";
import { parseQrTarget } from "@/lib/qr-target";
import { personalOnly } from "@/lib/edition";

export type WorkflowTab = "charge" | "nearby" | "records" | "account";

export interface ChargeWorkflowProps {
  state: WorkflowState;
  busy: boolean;
  onAction: (action: string, payload: Record<string, unknown>) => Promise<void>;
  activeTab: WorkflowTab;
  onTabChange: (tab: WorkflowTab) => void;
  nearbyPanel?: React.ReactNode;
  accountPanel?: React.ReactNode;
  children?: React.ReactNode;
  executorPanel?: React.ReactNode;
}

export default function ChargeWorkflow({
  state,
  busy,
  onAction,
  activeTab,
  onTabChange,
  nearbyPanel,
  accountPanel,
  children,
  executorPanel,
}: ChargeWorkflowProps) {
  const [localError, setLocalError] = useState("");

  const [accountUrl, setAccountUrl] = useState("");
  const [editingAccount, setEditingAccount] = useState(false);
  const [linkTarget, setLinkTarget] = useState<QrTarget | null>(null);

  const [selectedSchemeId, setSelectedSchemeId] = useState("");
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("");

  const [confirmedPlug, setConfirmedPlug] = useState(false);
  const [maxPrepayInput, setMaxPrepayInput] = useState("2");

  const [uncertainChecks, setUncertainChecks] = useState<Record<string, boolean>>({});

  const attempt = useRef<{ signature: string; id: string } | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!scheduleDate && !scheduleTime) {
      const iso = new Date(Date.parse(tomorrowAt("06:00", now)) + 8 * 3600_000).toISOString().split("T");
      setScheduleDate(iso[0]);
      setScheduleTime(iso[1].substring(0, 5));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setConfirmedPlug(false);
    if (state.quote && state.quote.schemes.length > 0) {
      if (!state.quote.schemes.find((s) => s.id === selectedSchemeId)) {
        setSelectedSchemeId(state.quote.schemes[0].id);
      }
    } else {
      setSelectedSchemeId("");
    }
  }, [
    state.quote?.fingerprint,
    state.target?.device,
    state.target?.port,
    selectedSchemeId,
    scheduleDate,
    scheduleTime,
    maxPrepayInput,
    state.profile.accountBound,
  ]);

  const wrapAction = async (action: string, payload: Record<string, unknown>) => {
    setLocalError("");
    try {
      await onAction(action, payload);
      return true;
    } catch (e: unknown) {
      setLocalError(e instanceof Error ? e.message : "操作失败");
      return false;
    }
  };

  const handleBindAccount = async (chosen?: QrTarget) => {
    setLocalError("");
    try {
      const incoming = parseQrTarget(accountUrl);
      if (!chosen && state.target && (state.target.device !== incoming.device || state.target.port !== incoming.port)) {
        setLinkTarget(incoming);
        return;
      }
      const target = chosen || state.target || incoming;
      await onAction("configureAccount", { url: accountUrl, target });
      setAccountUrl("");
      setLinkTarget(null);
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
      const signature = JSON.stringify([state.target, selectedSchemeId, state.quote.fingerprint, scheduledAt, maxPrepayCents]);
      if (attempt.current?.signature !== signature) attempt.current = { signature, id: crypto.randomUUID() };
      await onAction("reserve", {
        idempotencyKey: attempt.current!.id,
        target: state.target,
        schemeId: selectedSchemeId,
        quoteFingerprint: state.quote.fingerprint,
        scheduledAt,
        confirmedPlug,
        maxPrepayCents,
      });
      setConfirmedPlug(false);
    } catch (e: unknown) {
      setLocalError(e instanceof Error ? e.message : "预约失败");
    }
  };

  useEffect(() => {
    if (!state.profile.accountBound) {
      setAccountUrl("");
      attempt.current = null;
    }
  }, [state.profile.accountBound]);

  useEffect(() => {
    const old = state.bookings.find((b) => b.id === attempt.current?.id);
    if (old && ["cancelled", "reviewed", "failed", "missed", "rejected"].includes(old.phase)) {
      attempt.current = null;
    }
  }, [state.bookings]);

  const isQuoteMatching =
    !!state.quote &&
    !!state.target &&
    state.quote.device === state.target.device &&
    state.quote.port === state.target.port;

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
    }
    return `预约 ${scheduleDate.slice(5).replace("-", "月")}日 ${scheduleTime} 开电`;
  }, [scheduleDate, scheduleTime, now]);

  const activePhases: BookingPhase[] = [
    "scheduled",
    "waiting",
    "checking",
    "submitting",
    "pending",
    "uncertain",
  ];
  const activeBooking = state.bookings.find((b) => activePhases.includes(b.phase));
  const hasActiveBooking = !!activeBooking;
  const selectedScheme = state.quote?.schemes.find((s) => s.id === selectedSchemeId);
  const maxPrepayCents = /^\d+(\.\d{1,2})?$/.test(maxPrepayInput)
    ? Math.round(Number(maxPrepayInput) * 100)
    : NaN;

  const legacyTimeOk =
    !state.legacyGuard ||
    Date.parse(`${scheduleDate}T${scheduleTime}:00+08:00`) >= Date.parse(state.legacyGuard.until);

  const canReserve = !!(
    state.executor.connected &&
    state.executor.exactAlarm &&
    (state.executor.kind === "cloud" || state.executor.notifications) &&
    state.profile.accountBound &&
    isQuoteMatching &&
    state.quote?.available &&
    selectedScheme &&
    state.quote.balanceCents >= Math.max(200, selectedScheme.prepayCents) &&
    maxPrepayCents >= selectedScheme.prepayCents &&
    maxPrepayCents <= 1000 &&
    !hasActiveBooking &&
    confirmedPlug &&
    isValidTime &&
    legacyTimeOk &&
    !busy
  );

  const reserveBlockHint = useMemo(() => {
    if (!state.executor.connected) return state.executor.kind === "cloud" ? "云端暂不可用，请稍后刷新" : personalOnly ? "先恢复本人账号，再填写付款链接" : "正在连接浏览器身份，未连接可到设置中重试";
    if (state.executor.kind === "cloud" && !state.executor.exactAlarm) return "云端调度暂不可用，请稍后刷新核对";
    if (!state.profile.accountBound) return "请先填写并核对本人付款链接";
    if (!state.target) return "请先选择充电插座";
    if (!isQuoteMatching) return "请点击上方重新核对账号与插座";
    if (!state.quote?.available) return "当前插座暂不可用";
    if (!selectedScheme) return "当前无可用充电套餐";
    if (state.quote && selectedScheme && state.quote.balanceCents < Math.max(200, selectedScheme.prepayCents)) {
      return "余额不足，需至少2元且不低于预扣金额";
    }
    if (isNaN(maxPrepayCents) || (selectedScheme && maxPrepayCents < selectedScheme.prepayCents)) {
      return "预扣上限不能低于套餐预扣额";
    }
    if (maxPrepayCents > 1000) return "单次预扣上限不得超过10元";
    if (hasActiveBooking) return "当前已有生效或进行中的预约";
    if (!isValidTime) return "预约时间需在未来1分钟至48小时内";
    if (!legacyTimeOk) return state.legacyGuard?.message || "旧电脑保护生效中";
    if (!confirmedPlug) return "请先勾选下方接线与信息确认";
    return "";
  }, [
    state.executor.connected,
    state.executor.kind,
    state.executor.exactAlarm,
    state.profile.accountBound,
    state.target,
    isQuoteMatching,
    state.quote,
    selectedScheme,
    maxPrepayCents,
    hasActiveBooking,
    isValidTime,
    legacyTimeOk,
    state.legacyGuard,
    confirmedPlug,
  ]);

  const displayError = localError || state.error;

  return (
    <div className="cw-app" aria-busy={busy}>
      <GeminiHeader activeTab={activeTab} onTabChange={onTabChange}/>

      {displayError && (
        <div className="cw-alert" role="alert">
          <AlertTriangle className="cw-icon-sm cw-alert-icon" />
          <span className="cw-alert-text">{displayError}</span>
          {localError && (
            <button
              type="button"
              className="cw-alert-close"
              aria-label="关闭错误提示"
              onClick={() => setLocalError("")}
            >
              <X className="cw-icon-sm" />
            </button>
          )}
        </div>
      )}

      <main className="cw-main">
        {/* TAB 1: 晨充 */}
        <section
          id="tabpanel-charge"
          role="region"
          aria-label="晨充任务"
          hidden={activeTab !== "charge"}
          className="cw-panel cw-panel-charge"
        >
          <div className="cw-page-heading"><h2>预约充电</h2></div>
          {personalOnly && <p className="cw-text-sm cw-text-muted">个人云端预约 · 生效后可关闭网页，电脑无需开机</p>}
          {activeBooking && (
            <button
              type="button"
              className="cw-banner-active"
              onClick={() => onTabChange("records")}
            >
              <span className="cw-banner-tag">进行中</span>
              <span className="cw-banner-text">
                已有预约：{workflowPhaseNames[activeBooking.phase]}（{activeBooking.device}-{activeBooking.port}）
              </span>
              <ChevronRight className="cw-icon-sm" />
            </button>
          )}

          <div className="cw-status-bar">
            {state.executor.connected ? (
              <div className="cw-status-tag cw-status-tag--ok">
                <CheckCircle2 className="cw-icon-xs" />
                <span>{state.executor.exactAlarm ? "云端定时已就绪" : "云端定时暂不可用"}</span>
              </div>
            ) : (
              <button
                type="button"
                className="cw-status-tag cw-status-tag--action"
                onClick={() => onTabChange("account")}
              >
                <span>{state.executor.kind === "cloud" ? "云端暂未连接 · 查看设置" : personalOnly ? "恢复本人账号" : "浏览器身份连接中 · 查看设置"}</span>
                <ChevronRight className="cw-icon-xs" />
              </button>
            )}
          </div>

          <div className="cw-card cw-task-card">
            {/* Section: 设备插座 */}
            <div className="cw-task-row">
              <span className="cw-field-label">插座</span>
              <div className="cw-field-body">
                <div className="cw-target-main">
                  {state.target ? (
                    <div className="cw-target-val">
                      <strong className="cw-target-device">{state.target.device}</strong>
                      <span className="cw-target-port">{state.target.port}号插座</span>
                    </div>
                  ) : (
                    <span className="cw-text-muted">从端口查看选择，或粘贴付款链接</span>
                  )}
                  <button
                    type="button"
                    className="cw-btn-secondary cw-btn-compact"
                    disabled={busy}
                    onClick={() => onTabChange("nearby")}
                  >
                    {state.target ? "换插座" : "选插座"}
                  </button>
                </div>
                {state.target && (
                  <a
                    className="cw-target-link"
                    href={`https://www.szlzxn.cn/wechat/wxscan/${state.target.device}${state.target.port}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span>官方付款页</span>
                    <ExternalLink className="cw-icon-xs" />
                  </a>
                )}
              </div>
            </div>

            <div className="cw-card-sep" />

            {/* Section: 付款授权 */}
            <div className="cw-task-row">
              <div className="cw-field-label-group">
                <span className="cw-field-label">付款授权</span>
                <button
                  type="button"
                  className="cw-help-inline-btn"
                  aria-label="如何获取付款链接"
                  onClick={() => window.dispatchEvent(new Event("neptune-show-welcome"))}
                >
                  <HelpCircle className="cw-icon-xs" />
                </button>
              </div>
              <div className="cw-field-body">
                {state.profile.accountBound && !editingAccount ? (
                  <div className="cw-bound-row">
                    <span className="cw-bound-text">
                      <ShieldCheck className="cw-icon-xs cw-text-green" />
                      <span>已授权</span>
                    </span>
                    <button
                      type="button"
                      className="cw-btn-text"
                      disabled={busy || !state.executor.connected}
                      onClick={() => setEditingAccount(true)}
                    >
                      更换
                    </button>
                  </div>
                ) : (
                  <div className="cw-auth-input-group">
                    <input
                      aria-label="本人付款页授权链接"
                      disabled={busy || !state.executor.connected}
                      type="password"
                      autoComplete="off"
                      placeholder={state.executor.connected ? "粘贴微信本人付款页完整链接" : "正在连接，请稍候"}
                      className="cw-input cw-input-auth"
                      value={accountUrl}
                      onChange={(e) => {
                        setAccountUrl(e.target.value);
                        setLinkTarget(null);
                      }}
                    />
                    <button
                      type="button"
                      className="cw-btn-primary cw-btn-compact"
                      disabled={busy || !state.executor.connected || !accountUrl.trim()}
                      onClick={() => void handleBindAccount()}
                    >
                      核对
                    </button>
                  </div>
                )}

                {linkTarget && state.target && (
                  <div className="cw-link-choice" role="status">
                    <p className="cw-text-xs">
                      链接属于 {linkTarget.device}／{linkTarget.port}号，网页已选 {state.target.device}／{state.target.port}号：
                    </p>
                    <div className="cw-link-choice-actions">
                      <button
                        type="button"
                        className="cw-btn-secondary cw-btn-xs"
                        disabled={busy}
                        onClick={() => void handleBindAccount(state.target!)}
                      >
                        保留网页所选
                      </button>
                      <button
                        type="button"
                        className="cw-btn-primary cw-btn-xs"
                        disabled={busy}
                        onClick={() => void handleBindAccount(linkTarget)}
                      >
                        使用链接插座
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="cw-card-sep" />

            {/* Section: 充电套餐 */}
            <div className="cw-task-row">
              <span className="cw-field-label">套餐</span>
              <div className="cw-field-body">
                {state.target && state.profile.accountBound ? (
                  isQuoteMatching ? (
                    <div className="cw-scheme-group">
                      <div className="cw-scheme-select-row">
                        <select
                          aria-label="充电方案"
                          disabled={busy}
                          className="cw-input cw-select-scheme"
                          value={selectedSchemeId}
                          onChange={(e) => setSelectedSchemeId(e.target.value)}
                        >
                          {state.quote!.schemes.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.title}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="cw-btn-text cw-text-xs cw-btn-refresh"
                          disabled={busy || !state.executor.connected}
                          onClick={() => wrapAction("inspectTarget", {})}
                        >
                          刷新
                        </button>
                      </div>
                      <div className="cw-scheme-meta">
                        <span>
                          余额 <strong>¥{(state.quote!.balanceCents / 100).toFixed(2)}</strong>
                        </span>
                        {selectedScheme && (
                          <span className="cw-scheme-prepay">
                            预扣 <strong className="cw-text-orange">¥{(selectedScheme.prepayCents / 100).toFixed(2)}</strong>
                          </span>
                        )}
                      </div>
                      {selectedScheme?.description && (
                        <div className="cw-scheme-desc">{selectedScheme.description}</div>
                      )}
                      {!state.quote!.available && (
                        <div className="cw-text-warning cw-text-xs">插座暂不可用，请在微信核对</div>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="cw-btn-secondary cw-w-full cw-btn-compact"
                      disabled={busy || !state.executor.connected}
                      onClick={() => wrapAction("inspectTarget", {})}
                    >
                      核对账号与插座报价
                    </button>
                  )
                ) : (
                  <select disabled aria-label="充电方案" className="cw-input cw-select-scheme">
                    <option>授权后读取套餐</option>
                  </select>
                )}
              </div>
            </div>

            <div className="cw-card-sep" />

            {/* Section: 预约时间 */}
            <div className="cw-task-row">
              <div className="cw-field-label-group">
                <span className="cw-field-label">时间</span>
                <span className="cw-field-sub">北京时间</span>
              </div>
              <div className="cw-field-body">
                <div className="cw-datetime-grid">
                  <input
                    aria-label="开电日期（北京时间）"
                    disabled={busy}
                    type="date"
                    className="cw-input cw-datetime-field"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                  />
                  <input
                    aria-label="开电时间（北京时间）"
                    disabled={busy}
                    type="time"
                    className="cw-input cw-datetime-field"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                  />
                </div>
                {state.legacyGuard && (
                  <p className="cw-text-xs cw-text-warning cw-mt-4">{state.legacyGuard.message}</p>
                )}
              </div>
            </div>
          </div>

            <div className="cw-card cw-setting-card">
              <div className="cw-setting-row">
                <label htmlFor="cw-max-prepay-input" className="cw-setting-label">
                  单次预扣上限 (元)
                </label>
                <input
                  id="cw-max-prepay-input"
                  aria-label="单次预扣上限（元）"
                  disabled={busy}
                  type="number"
                  min="0.01"
                  max="10"
                  step="0.01"
                  className="cw-input cw-input-sm cw-w-24"
                  value={maxPrepayInput}
                  onChange={(e) => setMaxPrepayInput(e.target.value)}
                />
              </div>
              <p className="cw-setting-desc">
                超出上限不执行，最高 10 元。
              </p>
            </div>


          {/* 确认接线与主提交区 */}
          <div className="cw-action-section">
            <label className="cw-checkbox-row">
              <input
                disabled={busy}
                type="checkbox"
                checked={confirmedPlug}
                onChange={(e) => setConfirmedPlug(e.target.checked)}
              />
              <span className="cw-checkbox-text">
                已接好充电线，并核对插座、时间和套餐
              </span>
            </label>

            {state.executor.connected &&
              state.executor.kind !== "cloud" &&
              (!state.executor.exactAlarm || !state.executor.notifications) && (
                <div className="cw-perm-warning">
                  <span>缺少开电必备闹钟或通知权限</span>
                  <button
                    type="button"
                    className="cw-btn-text cw-text-xs"
                    disabled={busy}
                    onClick={() => {
                      if (!state.executor.notifications) wrapAction("openNotificationSettings", {});
                      else wrapAction("openAlarmSettings", {});
                    }}
                  >
                    去开启
                  </button>
                </div>
              )}

            <button
              type="button"
              className="cw-btn-primary cw-btn-hero"
              disabled={state.executor.kind === "none" ? busy : !canReserve}
              onClick={state.executor.kind === "none" ? () => onTabChange("account") : onReserve}
            >
              {state.executor.kind === "none" ? "查看连接状态" : busy ? "正在处理…" : reserveButtonText}
            </button>

            <div className="cw-action-footer-hint">
              {!canReserve && reserveBlockHint ? (
                <span className="cw-text-hint cw-text-hint--alert">{reserveBlockHint}</span>
              ) : (
                <span className="cw-text-hint">生效后可关闭网页</span>
              )}
            </div>
          </div>
        </section>

        {/* TAB 2: 找空位 */}
        <section
          id="tabpanel-nearby"
          role="region"
          aria-label="端口查看"
          hidden={activeTab !== "nearby"}
          className="cw-panel cw-panel-scrollable"
        >
          {nearbyPanel ? (
            <div className="cw-nearby-slot">{nearbyPanel}</div>
          ) : (
            <div className="cw-empty-slot">
              <MapPin className="cw-icon-lg cw-text-muted" />
              <p className="cw-empty-title">周边空位查询</p>
              <p className="cw-text-sm cw-text-muted">空位查询暂不可用，请稍后再试。</p>
            </div>
          )}
        </section>

        {/* TAB 3: 记录 */}
        <section
          id="tabpanel-records"
          role="region"
          aria-label="预约记录"
          hidden={activeTab !== "records"}
          className="cw-panel cw-panel-scrollable"
        >
          <div className="cw-page-heading"><h2>我的预约</h2></div>
          <div className="cw-records-container">
            <div className="cw-records-header">
              <span className="cw-records-title">全部记录 ({state.bookings.length})</span>
              <button className="cw-btn-secondary cw-btn-compact" disabled={busy || !state.executor.connected} onClick={() => wrapAction("refresh", {})}>刷新记录</button>
            </div>

            {state.bookings.length === 0 ? (
              <div className="cw-empty-slot">
                <Clock className="cw-icon-lg cw-text-muted" />
                <p className="cw-empty-title">暂无预约记录</p>
              </div>
            ) : (
              <div className="cw-bookings-list">
                {state.bookings.map((booking) => {
                  const isCancellable =
                    state.executor.kind === "cloud"
                      ? ["scheduled", "waiting", "checking"].includes(booking.phase)
                      : booking.phase === "scheduled" && new Date(booking.scheduledAt).getTime() - now > 30000;
                  const isUncertain = booking.phase === "uncertain";

                  return (
                    <div key={booking.id} className="cw-card cw-booking-card">
                      <div className="cw-booking-head">
                        <span className={`cw-phase-pill cw-phase-${booking.phase}`}>
                          {workflowPhaseNames[booking.phase]}
                        </span>
                        <span className="cw-booking-time">
                          {formatBookingTime(booking.scheduledAt)}
                        </span>
                      </div>

                      <div className="cw-booking-detail">
                        <strong>{booking.device}-{booking.port}</strong> · {booking.schemeTitle}
                      </div>

                      {booking.result && (
                        <div className="cw-booking-result">{booking.result}</div>
                      )}

                      {isUncertain && (
                        <div className="cw-uncertain-box">
                          <label className="cw-checkbox-row">
                            <input
                              type="checkbox"
                              disabled={busy}
                              checked={!!uncertainChecks[booking.id]}
                              onChange={(e) =>
                                setUncertainChecks((prev) => ({
                                  ...prev,
                                  [booking.id]: e.target.checked,
                                }))
                              }
                            />
                            <span className="cw-text-xs">已在官方平台查明结果</span>
                          </label>
                          <button
                            type="button"
                            className="cw-btn-primary cw-btn-xs cw-w-full cw-mt-4"
                            disabled={busy || !uncertainChecks[booking.id]}
                            onClick={() => {
                              if (window.confirm("旧请求不会再次发送，确定已核对？")) {
                                wrapAction("reviewUncertain", {
                                  id: booking.id,
                                  confirmedReview: true,
                                });
                              }
                            }}
                          >
                            确认核对完毕
                          </button>
                        </div>
                      )}

                      {isCancellable && (
                        <div className="cw-booking-footer">
                          <button
                            type="button"
                            className="cw-btn-secondary cw-btn-xs"
                            disabled={busy}
                            onClick={() => {
                              if (window.confirm("确定取消此项预约？")) {
                                wrapAction("cancel", { id: booking.id });
                              }
                            }}
                          >
                            取消预约
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* TAB 4: 我的 */}
        <section
          id="tabpanel-account"
          role="region"
          aria-label="我的与设置"
          hidden={activeTab !== "account"}
          className="cw-panel cw-panel-scrollable"
        >
          <div className="cw-page-heading"><h2>设置</h2></div>
          <div className="cw-account-container">
            {accountPanel && <div className="cw-account-slot">{accountPanel}</div>}
            {executorPanel && <div className="cw-executor-slot">{executorPanel}</div>}

            <div className="cw-card cw-setting-card">
              <div className="cw-guide-entry-row">
                <div className="cw-guide-text-group">
                  <span className="cw-guide-title">使用教程</span>
                </div>
                <button
                  type="button"
                  className="cw-btn-secondary cw-btn-compact"
                  onClick={() => window.dispatchEvent(new Event("neptune-show-welcome"))}
                >
                  查看指引
                </button>
              </div>
            </div>

            {children && <div className="cw-children-slot">{children}</div>}
          </div>
        </section>
      </main>

      <GeminiNavigation activeTab={activeTab} onTabChange={onTabChange} hasActiveBooking={hasActiveBooking}/>
    </div>
  );
}
