import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const config = [
  {
    ignores: ["public/vendor/novnc/**"],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
];

export default config;
