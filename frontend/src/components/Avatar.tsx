"use client";

import { useState } from "react";

/** Avatar: an uploaded photo when available, else a colored gradient with initials. */

const GRADIENTS = [
  "linear-gradient(135deg, #ff885e, #ff516a)", // red
  "linear-gradient(135deg, #ffcd6a, #ffa85c)", // orange
  "linear-gradient(135deg, #82b1ff, #665fff)", // violet
  "linear-gradient(135deg, #a0de7e, #54cb68)", // green
  "linear-gradient(135deg, #53edd6, #28c9b7)", // cyan
  "linear-gradient(135deg, #72d5fd, #2a9ef1)", // blue
  "linear-gradient(135deg, #e0a2f3, #d669ed)", // pink
];

function hashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export default function Avatar({
  name,
  src,
  size = 48,
  online,
}: {
  name: string;
  /** Uploaded photo URL; falls back to initials when empty or on load error. */
  src?: string;
  size?: number;
  /** Show a green online dot (pass undefined to hide entirely). */
  online?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = !!src && !failed;

  const initials = name
    .split(/[\s-_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name}
          onError={() => setFailed(true)}
          className="h-full w-full rounded-full object-cover"
          style={{ width: size, height: size }}
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center rounded-full font-medium text-white select-none"
          style={{
            background: GRADIENTS[hashCode(name) % GRADIENTS.length],
            fontSize: size * 0.4,
          }}
        >
          {initials || "?"}
        </div>
      )}
      {online !== undefined && (
        <span
          className={`absolute bottom-0 right-0 block rounded-full border-2 ${
            online ? "bg-[var(--online)]" : "bg-gray-300"
          }`}
          style={{
            width: size * 0.28,
            height: size * 0.28,
            borderColor: "var(--avatar-ring)",
          }}
        />
      )}
    </div>
  );
}
