import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import useLongPress from "../../hooks/utils/useLongPress";
import ActivityModal from "../../components/activity/ActivityModal";
import bgTexture from "../../assets/splash/bg-texture.png";
import plasticOverlay from "../../assets/splash/plastic-overlay.jpg";
import posterTaco from "../../assets/splash/poster-taco.jpg";
import star1 from "../../assets/splash/star-1.svg";
import star2 from "../../assets/splash/star-2.svg";
import star3 from "../../assets/splash/star-3.svg";
import star4 from "../../assets/splash/star-4.svg";
import star5 from "../../assets/splash/star-5.svg";
import star6 from "../../assets/splash/star-6.svg";
import tbBell from "../../assets/brand/tb-bell.svg";

/**
 * Attract/splash screen — Figma "Splash - Single" (node 1:2184), laid out in
 * design pixels on the 1080×1920 KioskStage.
 *
 * The promo poster ("Half Moon Half Price") is the Figma frame's static
 * content, used as the default attract poster; P3 wires it to the kiosk
 * media API (coverImage/banner rotation) the same way posistKiosk's
 * StartScreen does. Whole screen is one tap target (kiosk convention).
 */
export default function StartScreen() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [activityOpen, setActivityOpen] = useState(false);

  // Hidden operator gesture: press-and-hold the top-left corner for 3s to
  // open the Activity Center (diagnostics). Deliberately invisible; a short
  // tap on the hotspot falls through to nothing (not to start-order) so the
  // corner cannot mis-trigger an order start during servicing.
  const activityLongPress = useLongPress(
    () => setActivityOpen(true),
    () => {},
    { delay: 3000, shouldPreventDefault: true }
  );

  return (
    <div className="relative h-[1920px] w-[1080px]">
    <button
      type="button"
      aria-label={t("splash.startOrder")}
      data-testid="start-screen"
      onClick={() => navigate("/second")}
      className="relative block h-full w-full cursor-pointer overflow-hidden bg-tb-purple text-left"
    >
      {/* BG texture tile + plastic sheen (Figma BG TEXTURE 1:2185) */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${bgTexture})`,
          backgroundSize: "240px 240px",
          backgroundPosition: "top left",
        }}
      />
      <img
        aria-hidden
        alt=""
        src={plasticOverlay}
        className="absolute inset-0 h-full w-full object-cover opacity-40 mix-blend-soft-light"
      />

      {/* Taco Bell bell (1:2202) */}
      <img
        alt="Taco Bell"
        src={tbBell}
        className="absolute left-1/2 top-[101px] h-[89px] w-[100px] -translate-x-1/2"
      />

      {/* Promo poster (1:2188) */}
      <div className="absolute left-[78px] top-[286px] h-[1338px] w-[924px] overflow-hidden rounded-[16px] bg-tb-purple-vibrant">
        <img
          alt=""
          src={posterTaco}
          className="absolute left-1/2 top-[418px] h-[755px] w-[574px] -translate-x-1/2 object-cover"
        />
        <h1 className="tb-display absolute left-[48px] top-[161px] text-[103px] leading-[0.95] tracking-[-8.7px] text-tb-surface">
          Half
          <br />
          moon
        </h1>
        <h1 className="tb-display absolute right-[45px] top-[348px] text-right text-[103px] leading-[0.95] tracking-[-8.7px] text-tb-surface">
          half
          <br />
          price
        </h1>
        <p className="absolute bottom-[84px] left-1/2 w-[393px] -translate-x-1/2 text-center text-[21.76px] font-bold uppercase leading-[1.1] text-tb-cream">
          happy hour 2-4pm get half price on half moons
        </p>
        {/* Star scribbles */}
        <img aria-hidden alt="" src={star4} className="absolute right-[68px] top-[890px] w-[115px] -scale-x-100" />
        <img aria-hidden alt="" src={star1} className="absolute left-[-11px] top-[745px] w-[63px] -scale-x-100" />
        <img aria-hidden alt="" src={star2} className="absolute right-[251px] top-[630px] w-[38px] -scale-x-100" />
        <img aria-hidden alt="" src={star3} className="absolute right-[-8px] top-[420px] w-[124px]" />
        <img aria-hidden alt="" src={star5} className="absolute left-[300px] top-[428px] w-[38px] rotate-180" />
        <img aria-hidden alt="" src={star6} className="absolute left-[228px] top-[36px] w-[60px]" />
      </div>

      {/* start order (Component 1, 1:2187) */}
      <p className="tb-display absolute left-1/2 top-[1752px] -translate-x-1/2 text-center text-[32px] leading-[32px] tracking-[-1px] text-tb-surface">
        {t("splash.startOrder")}
      </p>
    </button>
    <div
      data-testid="activity-hotspot"
      aria-hidden
      {...activityLongPress}
      onClick={(e) => e.stopPropagation()}
      className="absolute left-0 top-0 z-20 h-[180px] w-[180px]"
    />
    <ActivityModal isOpen={activityOpen} onClose={() => setActivityOpen(false)} />
    </div>
  );
}
