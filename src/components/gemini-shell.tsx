"use client";

import { MapPin, Zap, History, User, HelpCircle } from 'lucide-react';
import type { WorkflowTab } from './charge-workflow';

const tabs = [
  { id: 'nearby' as const, label: '端口查看', icon: MapPin },
  { id: 'charge' as const, label: '预约充电', icon: Zap },
  { id: 'records' as const, label: '我的预约', icon: History },
  { id: 'account' as const, label: '设置', icon: User },
];

export function GeminiNavigation({ activeTab, onTabChange, desktop = false, hasActiveBooking = false }: {
  activeTab: WorkflowTab; onTabChange: (tab: WorkflowTab) => void; desktop?: boolean; hasActiveBooking?: boolean;
}) {
  return <nav className={desktop ? 'cw-desktop-nav' : 'cw-nav'} aria-label={desktop ? '顶部导航' : '底栏导航'}>
    {tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button"
      className={`cw-nav-item ${activeTab === id ? 'cw-nav-item--active' : ''}`}
      aria-current={activeTab === id ? 'page' : undefined} aria-controls={`tabpanel-${id}`} onClick={() => onTabChange(id)}>
      <span className="cw-nav-badge-wrap"><Icon className="cw-nav-icon"/>{id === 'records' && hasActiveBooking && <span className="cw-nav-dot"/>}</span>
      <span className="cw-nav-text">{label}</span>
    </button>)}
  </nav>;
}

export function GeminiHeader({ activeTab, onTabChange }: { activeTab: WorkflowTab; onTabChange: (tab: WorkflowTab) => void }) {
  return <header className="cw-header"><div className="cw-header-inner">
    <div className="cw-brand"><img src="/brand.svg" width="36" height="36" alt=""/><div><h1 className="cw-logo-title">晨充</h1></div></div>
    <GeminiNavigation activeTab={activeTab} onTabChange={onTabChange} desktop/>
    <div className="cw-header-actions">
      <button type="button" className="cw-header-help-btn" aria-current={activeTab === 'account' ? 'page' : undefined} onClick={() => onTabChange('account')}><User size={16}/><span>设置</span></button>
      <button type="button" className="cw-header-help-btn" aria-label="新手指引" onClick={() => window.dispatchEvent(new Event('neptune-show-welcome'))}><HelpCircle size={16}/><span>教程</span></button>
    </div>
  </div></header>;
}

