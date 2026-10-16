import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ActivityModalProps } from "./ActivityModal";
import { loadActivityModal, loadedActivityModal } from "./loadActivityModal";

/**
 * The operator Activity Center off the boot path (P9f budget): loaded on the
 * first open (the 3 s hidden hold, loadActivityModal). Until it arrives, the
 * modal's own scrim — closing like it — so a slow or failed load never traps
 * the screen (the boot screen hides its error dialog and hotspot while this
 * is open). Plain state, not React.lazy + Suspense: Suspense reveals after a
 * fallback on a 300 ms timer, which a frozen e2e clock would hold.
 */
export default function ActivityCenter(props: ActivityModalProps) {
  const { t } = useTranslation();
  const { isOpen, onClose } = props;
  const [Modal, setModal] = useState(() => loadedActivityModal());
  // Perf ENTRY-2: the modal and its store subscriptions mount at this
  // visit's first open, not with the screen. From then on it stays mounted
  // while closed, as before, so its own state (the passcode prompt, a typed
  // passcode, the logout confirm) still survives a close and reopen.
  const [opened, setOpened] = useState(isOpen);
  if (isOpen && !opened) setOpened(true);

  useEffect(() => {
    if (!isOpen || Modal) return;
    let live = true;
    const load = async () => {
      const loaded = await loadActivityModal();
      if (live && loaded) setModal(() => loaded);
    };
    void load();
    return () => { live = false; };
  }, [isOpen, Modal]);

  if (!opened) return null;
  if (Modal) return <Modal {...props} />;
  if (!isOpen) return null;
  return (
    <button
      type="button"
      aria-label={t("language.close")}
      data-testid="activity-loading"
      onClick={onClose}
      className="absolute inset-0 z-50 h-full w-full bg-tb-ink-purple/80"
    />
  );
}
