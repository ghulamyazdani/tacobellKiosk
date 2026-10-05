import { useSelector } from "react-redux";
import { selectSelectedLanguage } from "../../redux/features/multiLanguage/multiLanguage.slice";

const useMenuUtils = () => {
  const selectedLanguage = useSelector(selectSelectedLanguage);
  function generateString(min: number, max: number): string {
    let str = "Select ";
    if (min === max) {
      str += `exactly ${min}`;
    } else if (max === Infinity) {
      str += `at least ${min}`;
    } else if (min === 0) {
      str += `up to ${max}`;
    } else {
      str += `between ${min} and ${max}`;
    }
    str += ` item${max !== 1 ? "s" : ""}`;
    return str;
  }

  function generateArabicString(min: number, max: number): string {
    let str = "اختر ";
    if (min === max) {
      str += `بالضبط ${min}`;
    } else if (max === Infinity) {
      str += `على الأقل ${min}`;
    } else if (min === 0) {
      str += `حتى ${max}`;
    } else {
      str += `بين ${min} و ${max}`;
    }

    // Handle pluralization for Arabic (basic logic, can be enhanced)
    if (max === 1 || min === 1) {
      str += " عنصر";
    } else {
      str += " عناصر";
    }

    // console.log("Arabic string", str);

    return str;
  }

  return selectedLanguage === "ar" ? generateArabicString : generateString;
};

export default useMenuUtils;
