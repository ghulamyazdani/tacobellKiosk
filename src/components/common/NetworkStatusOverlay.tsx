import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useNetworkStatus } from "../../hooks/useNetworkStatus";

/** Full-screen offline blocker (Rule 2: never a frozen/blank screen). */
const NetworkStatusOverlay = () => {
  const isOnline = useNetworkStatus();
  const { t } = useTranslation();

  if (isOnline) return null;

  return createPortal(
    <AnimatePresence>
      {!isOnline && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[99999] flex flex-col items-center justify-center bg-tb-purple/95 p-8 backdrop-blur-sm"
        >
          <h2 className="tb-display mb-4 text-center text-5xl text-tb-surface">
            {t("network.title")}
          </h2>
          <p className="max-w-xl text-center text-2xl leading-relaxed text-tb-cream">
            {t("network.subtitle")}
          </p>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default NetworkStatusOverlay;
