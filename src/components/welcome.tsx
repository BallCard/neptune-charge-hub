"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, X, ZoomIn, ZoomOut } from "lucide-react";
import "./welcome.css";
import { personalOnly } from '@/lib/edition';

const sharedPages = [
  { title: "先登录晨充", text: "点右上角「账号」注册，填写邮件中的验证码后登录。", image: "/guide/account-v2.png", alt: "晨充账号页，邮箱、密码和注册按钮", focus: [30, 39], detail: "注册", wide: false, note: "每人独立账号和付款授权。忘记密码可用邮箱验证码找回。" },
  { title: "选一个空闲插座", text: "单击绿色插座选中，双击打开对应付款入口。", image: "/guide/socket-v2.png", alt: "晨充真实站点插座列表，绿色为空闲插座", focus: [16, 59], detail: "空闲插座", wide: false, note: "现场扫码也可以；请在微信内打开付款页。" },
  { title: "打开付款页的菜单", text: "等本人余额和套餐加载好，核对插座后点右上角「…」。", image: "/guide/wechat-payment.png", alt: "用户提供的官方付款页截图，保留插座、套餐和右上角菜单，已裁去状态栏与个人余额", focus: [93, 6], detail: "右上角的 …", wide: true, note: "此时不用付款。截图中的套餐与插座仅作操作示例。" },
  { title: "用其他应用打开", text: "在微信菜单中，点「用其他应用打开」。", image: "/guide/wechat-open-app.png", alt: "用户微信菜单截图，第三项是用其他应用打开", focus: [45, 53], detail: "用其他应用打开", wide: true, note: "按你的 iPhone 截图演示；若菜单已有「复制链接」，可直接复制。" },
  { title: "点「拷贝」", text: "在系统分享面板点「拷贝」，然后回到晨充。", image: "/guide/ios-copy.png", alt: "用户系统分享面板截图，最左侧是拷贝", focus: [13, 39], detail: "拷贝", wide: true, note: "完整链接含付款授权，请勿转发他人。" },
  { title: "核对后再预约", text: "粘贴链接并核对，选套餐和北京时间；接好线后确认预约。", image: "/guide/booking-v2.png", alt: "晨充预约页中的付款授权、套餐和时间，截图为未登录状态", focus: [53, 51], detail: "付款授权", wide: false, note: "授权加密保存。预约显示生效后，才可关闭网页。" },
];
const pages = personalOnly ? [
  { ...sharedPages[1], text: '首页查看玉泉各站点端口，点绿色插座选中；「导航」可打开高德或百度地图。', note: '可直接查端口，无需登录。选中后点「付款页」或「去预约」，状态以现场为准。' },
  { ...sharedPages[0], title: '登录本人账号', text: '点右上角「账号」，登录已有晨充账号。', image: '/guide/account-personal.png', alt: '个人版账号页，仅有登录按钮，不开放注册', focus: [15, 38], detail: '登录', note: '个人版仅本人可用，无需重新注册。' },
  ...sharedPages.slice(2, -1),
  { ...sharedPages[5], text: '现场扫码并复制本人付款链接，粘贴后读取插座与套餐；接好线，再选北京时间预约。', note: '显示预约生效后可关闭网页，电脑无需开机。云端按分钟执行，超出十分钟窗口则停止。' },
] : [
  { ...sharedPages[1], text: '首页直接查看端口。选中空闲插座后，进入预约充电。', note: '无需注册或登录。首次进入预约时自动记住本浏览器，请使用固定浏览器并保留网站数据。' },
  ...sharedPages.slice(2, -1),
  { ...sharedPages[5], text: '粘贴本人付款链接并核对，选套餐和北京时间；接好线后确认预约。', note: '显示生效后可关闭网页或电脑。清除网站数据或换设备无法自动找回记录，原云端预约仍会执行。' },
];

export function Welcome() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const page = pages[step];
  const openModal = useCallback(() => {
    setStep(0); setZoomed(false);
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
  }, []);
  const closeModal = useCallback(() => { dialogRef.current?.close(); }, []);
  useEffect(() => {
    window.addEventListener("neptune-show-welcome", openModal);
    return () => window.removeEventListener("neptune-show-welcome", openModal);
  }, [openModal]);
  const go = (next: number) => { setStep(Math.max(0, Math.min(pages.length - 1, next))); setZoomed(false); bodyRef.current?.scrollTo(0, 0); };
  return <dialog ref={dialogRef} className="cw-welcome" aria-labelledby="cw-welcome-title"
    onCancel={event => { event.preventDefault(); closeModal(); }}
    onKeyDown={event => { if (event.key === "ArrowRight") { event.preventDefault(); go(step + 1); } if (event.key === "ArrowLeft") { event.preventDefault(); go(step - 1); } }}>
    <div className="cw-welcome-panel">
      <header className="cw-welcome-header">
        <div className="cw-guide-brand"><img src="/brand.svg" width="32" height="32" alt=""/><strong>晨充使用指南</strong></div>
        <button className="cw-welcome-close" onClick={closeModal} aria-label="关闭新手指引"><X size={20}/></button>
      </header>
      <div className="cw-guide-progress" aria-label={`第 ${step + 1} 页，共 ${pages.length} 页`}>
        {pages.map((item, index) => <button key={item.title} aria-label={`第 ${index + 1} 页：${item.title}`} aria-current={index === step ? 'step' : undefined} onClick={() => go(index)}><span className={index <= step ? 'is-done' : ''}/></button>)}
      </div>
      <div ref={bodyRef} className="cw-welcome-body">
        <div className="cw-guide-copy" aria-live="polite">
          <span className="cw-guide-eyebrow">{String(step + 1).padStart(2, '0')} / {String(pages.length).padStart(2, '0')}</span>
          <h2 id="cw-welcome-title">{page.title}</h2><p>{page.text}</p>
        </div>
        <figure className={`cw-guide-figure ${page.wide ? 'cw-guide-wide' : ''}`}>
          <button className={`cw-guide-screenshot ${zoomed ? 'is-zoomed' : ''}`} onClick={() => setZoomed(!zoomed)} aria-label={zoomed ? '还原截图' : `放大查看${page.detail}`} aria-pressed={zoomed}>
            <img src={page.image} alt={page.alt} style={{ transformOrigin: `${page.focus[0]}% ${page.focus[1]}%` }}/>
            {!zoomed && <span className="cw-guide-focus" style={{ left: `${page.focus[0]}%`, top: `${page.focus[1]}%` }}/>}
            <span className="cw-guide-zoom">{zoomed ? <ZoomOut size={16}/> : <ZoomIn size={16}/>} {zoomed ? '还原' : '放大'}</span>
          </button><figcaption>界面截图 · {page.detail}</figcaption>
        </figure>
        <p className="cw-guide-note">{page.note}</p>
      </div>
      <footer className="cw-welcome-footer">
        <button className="cw-guide-back" onClick={() => step === 0 ? closeModal() : go(step - 1)}>{step === 0 ? '稍后再看' : <><ArrowLeft size={16}/>上一步</>}</button>
        <button className="cw-welcome-confirm" onClick={() => step === pages.length - 1 ? closeModal() : go(step + 1)}>{step === pages.length - 1 ? <>开始使用<Check size={17}/></> : <>下一步<ArrowRight size={17}/></>}</button>
      </footer>
    </div>
  </dialog>;
}
export default Welcome;
