/* eslint-disable @typescript-eslint/no-explicit-any --
 * Verbatim copy of the posistKiosk AutoScroll util (customization vertical
 * port). The anys are inherited; typed in later domain passes. Do not add NEW
 * anys.
 */
const AutoScroll = (
  windowParentElement: any,
  windowChildElement: any,
  negativeMargin: any,
) => {
  windowParentElement?.scrollTo({
    top: windowChildElement - negativeMargin,
    behavior: "smooth",
    transition: "all 1s ease-in-out",
  });
};

export default AutoScroll;
