/* eslint-disable @typescript-eslint/no-explicit-any --
 * Verbatim copy of the posistKiosk AutoScroll util (customization vertical
 * port). The anys are inherited; typed in later domain passes. Do not add NEW
 * anys.
 */
/** "smooth" — or an instant jump when the OS asks for reduced motion (read per call). */
export const scrollBehavior = (): ScrollBehavior =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

const AutoScroll = (
  windowParentElement: any,
  windowChildElement: any,
  negativeMargin: any,
) => {
  windowParentElement?.scrollTo({
    top: windowChildElement - negativeMargin,
    behavior: scrollBehavior(),
    transition: "all 1s ease-in-out",
  });
};

export default AutoScroll;
