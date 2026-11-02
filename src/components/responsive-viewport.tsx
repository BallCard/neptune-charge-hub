"use client";
import { useEffect, useRef, type ReactNode } from 'react';

export default function ResponsiveViewport({ children }: { children: ReactNode }) {
  const measure = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    const style = document.documentElement.style;
    const resize = () => {
      if (!viewport || viewport.scale === 1) style.setProperty('--cw-viewport-height', `${viewport?.height ?? window.innerHeight}px`);
    };
    resize();
    viewport?.addEventListener('resize', resize);
    let observer: IntersectionObserver | undefined;
    let resizeObserver: ResizeObserver | undefined;
    if (window.self !== window.top && measure.current) {
      // The host can center a 1280px iframe on phones. Measure our visible
      // rectangle without accessing or modifying the cross-origin parent.
      const intersections = new Map<Element, DOMRectReadOnly>();
      observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0) intersections.set(entry.target, entry.intersectionRect);
          else intersections.delete(entry.target);
        }
        const visible = [...intersections.values()];
        if (!visible.length) return;
        const left = Math.min(...visible.map(rect => rect.left)), top = Math.min(...visible.map(rect => rect.top));
        style.setProperty('--cw-frame-width', `${Math.max(...visible.map(rect => rect.right)) - left}px`);
        style.setProperty('--cw-frame-height', `${Math.max(...visible.map(rect => rect.bottom)) - top}px`);
        style.setProperty('--cw-frame-x', `${left}px`);
        style.setProperty('--cw-frame-y', `${top}px`);
      }, { threshold: Array.from({ length: 1001 }, (_, index) => index / 1000) });
      // Tiles also detect the parent scrolling while the total visible area
      // stays the same, e.g. when the browser focuses a modal in a wide iframe.
      const tiles = [...measure.current.children];
      const observe = () => {
        intersections.clear(); observer?.disconnect();
        for (const tile of tiles) observer?.observe(tile);
      };
      observe();
      resizeObserver = new ResizeObserver(observe);
      resizeObserver.observe(measure.current);
    }
    return () => {
      observer?.disconnect(); resizeObserver?.disconnect(); viewport?.removeEventListener('resize', resize);
      for (const name of ['--cw-viewport-height', '--cw-frame-width', '--cw-frame-height', '--cw-frame-x', '--cw-frame-y']) style.removeProperty(name);
    };
  }, []);
  return <><div ref={measure} className="cw-viewport-measure" aria-hidden="true">{Array.from({ length: 64 }, (_, index) => <span key={index}/>)}</div><div className="cw-viewport">{children}</div></>;
}
