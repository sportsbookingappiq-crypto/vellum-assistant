/**
 * Source code with syntax colours. Only the languages a sandbox commonly
 * writes are registered, so the highlighter stays small; anything else is
 * shown as plain text. highlight.js escapes the source before it wraps the
 * tokens, which is what makes its HTML safe to insert.
 */

import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { useMemo } from "react";

const LANGUAGES = {
  bash,
  css,
  go,
  java,
  javascript,
  json,
  python,
  ruby,
  rust,
  sql,
  typescript,
  xml,
  yaml,
};

for (const [name, language] of Object.entries(LANGUAGES)) {
  if (!hljs.getLanguage(name)) {
    hljs.registerLanguage(name, language);
  }
}

interface AnuCodeViewProps {
  code: string;
  language: string | undefined;
}

export function AnuCodeView({ code, language }: AnuCodeViewProps) {
  const html = useMemo(() => {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    }
    return null;
  }, [code, language]);

  return (
    <pre
      dir="ltr"
      className="anu-code overflow-x-auto rounded-xl bg-[var(--surface-sunken)] p-4 font-mono text-[13px] leading-5 text-[var(--content-default)]"
    >
      {html === null ? (
        <code>{code}</code>
      ) : (
        <code dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </pre>
  );
}
