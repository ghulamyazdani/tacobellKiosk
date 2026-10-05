import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full w-[1080px] flex-col items-center justify-center gap-8 bg-tb-purple">
      <h1 className="tb-display text-6xl text-tb-surface">{t("notFound.title")}</h1>
      <Link
        to="/start"
        className="tb-display min-h-[44px] min-w-[44px] rounded-full bg-tb-surface px-12 py-5 text-2xl text-tb-purple"
      >
        {t("notFound.backToStart")}
      </Link>
    </div>
  );
}
