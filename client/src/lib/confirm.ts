/** Promise-based replacement for window.confirm(). Native pop-ups are silently blocked in embedded browsers
 *  (e.g. the Claude app's built-in browser), which made buttons like "Disconnect" appear to do nothing. */
export function askConfirm(message: string, okLabel = 'Yes, continue'): Promise<boolean> {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4';
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
    const box = document.createElement('div');
    box.className = 'w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-ink-700 dark:bg-ink-800';
    const p = document.createElement('p'); p.className = 'text-sm'; p.textContent = message;
    const row = document.createElement('div'); row.className = 'mt-5 flex justify-end gap-2';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn-ghost'; cancel.textContent = 'Cancel';
    const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'btn-primary'; ok.textContent = okLabel;
    const done = (v: boolean) => { document.removeEventListener('keydown', onKey); overlay.remove(); prevFocus?.focus?.(); resolve(v); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') done(false); };
    cancel.onclick = () => done(false); ok.onclick = () => done(true);
    overlay.onclick = (e) => { if (e.target === overlay) done(false); };
    document.addEventListener('keydown', onKey);
    row.append(cancel, ok); box.append(p, row); overlay.append(box); document.body.append(overlay);
    ok.focus();
  });
}
