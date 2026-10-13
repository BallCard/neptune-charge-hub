"use client";
import React, { useEffect, useRef, useCallback } from "react";
import "./welcome.css";
import { X } from "lucide-react";

const WELCOME_STORAGE_KEY = "neptune-welcome-web-v3";

export function Welcome() {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  const openModal = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") {
      try {
        if (!dialog.open) {
          dialog.showModal();
        }
      } catch {
        dialog.setAttribute("open", "");
      }
    } else {
      dialog.setAttribute("open", "");
    }
    if (!dialog.open) {
      dialog.setAttribute("open", "");
    }
  }, []);

  const markSeen = useCallback(() => {
    try {
      window.localStorage.setItem(WELCOME_STORAGE_KEY, "1");
    } catch {
      // Ignore storage access errors in restricted environments
    }
  }, []);

  const closeModal = useCallback(() => {
    markSeen();
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.close === "function") {
      try {
        if (dialog.open) {
          dialog.close();
        }
      } catch {
        dialog.removeAttribute("open");
      }
    } else {
      dialog.removeAttribute("open");
    }
    if (dialog.open) {
      dialog.removeAttribute("open");
    }
  }, [markSeen]);

  useEffect(() => {
    let seen = false;
    try {
      seen = Boolean(window.localStorage.getItem(WELCOME_STORAGE_KEY));
    } catch {
      seen = false;
    }
    if (!seen) {
      openModal();
      markSeen();
    }

    const handleShowWelcome = () => {
      openModal();
    };

    window.addEventListener("neptune-show-welcome", handleShowWelcome);
    return () => {
      window.removeEventListener("neptune-show-welcome", handleShowWelcome);
    };
  }, [openModal, markSeen]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeModal();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="cw-welcome"
      aria-labelledby="cw-welcome-title"
      onClose={markSeen}
      onKeyDown={handleKeyDown}
    >
      <div className="cw-welcome-panel">
        <header className="cw-welcome-header">
          <div>
            <h2 id="cw-welcome-title" className="cw-welcome-title">
              晨充 · 新手指引
            </h2>
            <p className="cw-welcome-subtitle">今晚接好插头，明早到点核对开电</p>
          </div>
          <button
            type="button"
            className="cw-welcome-close"
            aria-label="关闭新手指引"
            onClick={closeModal}
          >
            <X className="cw-welcome-icon" />
          </button>
        </header>

        <div className="cw-welcome-body">
          <ol className="cw-welcome-steps">
            <li className="cw-welcome-step">
              <span className="cw-welcome-step-badge">1</span>
              <div className="cw-welcome-step-text">
                <strong>登录并选择插座</strong>
                <span>在网页选空闲插座，或用微信扫现场插座码。登录晨充后填本人付款链接即可。</span>
              </div>
            </li>
            <li className="cw-welcome-step">
              <span className="cw-welcome-step-badge">2</span>
              <div className="cw-welcome-step-text">
                <strong>复制微信本人付款页链接导入一次</strong>
                <span>微信官方付款页出现本人余额与方案后，点右上角“…”复制链接并保存，首次仅只读核对。</span>
              </div>
            </li>
            <li className="cw-welcome-step">
              <span className="cw-welcome-step-badge">3</span>
              <div className="cw-welcome-step-text">
                <strong>核对方案、时间并勾选已接好</strong>
                <span>确认真实方案与价格、默认北京时间明天 06:00 及车辆插头已接好后，点击预约。</span>
              </div>
            </li>
            <li className="cw-welcome-step">
              <span className="cw-welcome-step-badge">4</span>
              <div className="cw-welcome-step-text">
                <strong>云端登记后，关闭网页也能执行</strong>
                <span>以本页“预约已生效”记录为准。到点由云端核对并尝试开电，结果回到本页查看，并以微信官方订单核对。</span>
              </div>
            </li>
          </ol>

          <details className="cw-welcome-details">
            <summary>如何复制授权链接（永久可查阅）</summary>
            <div className="cw-welcome-details-body">
              <ol className="cw-welcome-sublist">
                <li>打开微信扫一扫插座二维码（或从相册识别插座图片），进入尼普顿官方充电页面。</li>
                <li>等待页面加载出<strong>本人账户余额与可选充电方案</strong>，确认当前为本人微信登录。</li>
                <li>点击微信右上角“…”菜单，选择“复制链接”。</li>
                <li>回到晨充网页，登录后粘贴到“本人付款链接”并点击核对保存。</li>
              </ol>
              <p className="cw-welcome-note">
                插座二维码链接不含个人身份，不能直接用于扣款开电；本人付款页完整链接含授权凭证，保存时交给晨充云端加密托管，用于到点开电。请勿转发他人。
              </p>
            </div>
          </details>

          <div className="cw-welcome-platform-box">
            <p className="cw-welcome-platform-text">
              <strong>执行环境说明：</strong>
              安卓和 iPhone 均使用网页，无需安装 APK。云端预约生效后不依赖电脑开机；未出现“预约已生效”记录就没有登记成功。旧电脑预约仍由原电脑执行，请勿重复登记。
            </p>
          </div>
        </div>

        <footer className="cw-welcome-footer">
          <button type="button" className="cw-welcome-confirm" onClick={closeModal}>
            我知道了
          </button>
        </footer>
      </div>
    </dialog>
  );
}

export default Welcome;
