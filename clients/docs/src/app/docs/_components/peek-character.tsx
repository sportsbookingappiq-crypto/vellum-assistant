"use client";

import { useEffect, useRef, useState } from "react";

// The docs TOC peek character: the azure, curious-eyed Rime (the `urchin`
// body, `teal` colour id) that pops up
// from the bottom of the viewport under the community speech bubble.
//
// The SVG path data and the body/eye transform math mirror the assistant's
// avatar pipeline (packages/avatar-catalog and
// svg-compositor.ts) so this character renders identically to the same
// urchin composed by the daemon. Keep them in sync if the catalog changes.

const URCHIN_BODY = {
  viewBox: { width: 565, height: 556 },
  faceCenter: { x: 282, y: 308 },
  svgPath:
    "M234.07 74.71L275.81 6.46C279.44 0.51 284.7 0.51 288.33 6.46L330.07 74.71C339.15 89.55 358.13 98.1 375.27 95.06L424.25 86.36C431.11 85.14 436.77 89.25 437.73 96.14L444.59 145.42C446.99 162.66 460.98 178.07 477.9 182.11L555.72 200.72C562.49 202.34 564.11 207.34 559.59 212.63L507.57 273.41C496.26 286.65 494 307.33 502.19 322.69L525.6 366.59C528.88 372.73 526.71 379.39 520.45 382.42L475.71 404.19C460.06 411.79 449.73 429.85 451.11 447.21L457.45 526.96C458.01 533.9 453.75 536.99 447.32 534.32L373.43 503.64C357.36 496.97 336.99 501.21 324.91 513.74L290.4 549.58C285.57 554.59 278.57 554.59 273.74 549.58L239.23 513.74C227.15 501.21 206.78 496.97 190.71 503.64L116.82 534.32C110.39 536.99 106.13 533.9 106.69 526.96L113.03 447.21C114.41 429.85 104.08 411.79 88.43 404.19L43.69 382.42C37.43 379.39 35.26 372.73 38.54 366.59L61.95 322.69C70.14 307.33 67.88 286.65 56.57 273.41L4.55 212.63C0.03 207.34 1.65 202.34 8.42 200.72L86.24 182.11C103.16 178.07 117.15 162.66 119.55 145.42L126.41 96.14C127.37 89.25 133.03 85.14 139.89 86.36L188.87 95.06C206.01 98.1 224.99 89.55 234.07 74.71Z",
};

const SCLERA = "#F4F8FD";
const PUPIL = "#0F1C38";

const CURIOUS_EYES = {
  sourceViewBox: { width: 600, height: 600 },
  eyeCenter: { x: 300, y: 300 },
  paths: [
    {
      svgPath:
        "M260 318C260 353.35 231.35 382 196 382C160.65 382 132 353.35 132 318C132 282.65 160.65 254 196 254C231.35 254 260 282.65 260 318Z",
      color: SCLERA,
    },
    {
      svgPath:
        "M252 304C252 324.99 234.99 342 214 342C193.01 342 176 324.99 176 304C176 283.01 193.01 266 214 266C234.99 266 252 283.01 252 304Z",
      color: PUPIL,
    },
    {
      svgPath:
        "M235 292C235 298.08 230.08 303 224 303C217.92 303 213 298.08 213 292C213 285.92 217.92 281 224 281C230.08 281 235 285.92 235 292Z",
      color: SCLERA,
    },
    {
      svgPath:
        "M486 298C486 345.5 447.5 384 400 384C352.5 384 314 345.5 314 298C314 250.5 352.5 212 400 212C447.5 212 486 250.5 486 298Z",
      color: SCLERA,
    },
    {
      svgPath:
        "M474 276C474 303.61 451.61 326 424 326C396.39 326 374 303.61 374 276C374 248.39 396.39 226 424 226C451.61 226 474 248.39 474 276Z",
      color: PUPIL,
    },
    {
      svgPath:
        "M452 260C452 267.73 445.73 274 438 274C430.27 274 424 267.73 424 260C424 252.27 430.27 246 438 246C445.73 246 452 252.27 452 260Z",
      color: SCLERA,
    },
  ],
};

// The "teal" palette id, which ANU paints azure.
const TEAL = "#2F86E0";

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// SSR renders the motion-on path (false), then syncs to the media query on
// mount so the blink/twitch timers never schedule for motion-sensitive
// readers. The CSS breathe pulse is gated separately via a media query.
function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReduce(mq.matches);
    const onChange = () => setReduce(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduce;
}

// Body transform: aspect-fit scale + center translation from the body viewBox
// to the output size. Eye transform: remap from the eye sourceViewBox into the
// body viewBox (aligning eyeCenter onto the body's faceCenter), composed with
// the body-to-output transform.
function computeLayout(size: number) {
  const bodyVB = URCHIN_BODY.viewBox;
  const bodyScale = Math.min(size / bodyVB.width, size / bodyVB.height);
  const bodyTx = (size - bodyVB.width * bodyScale) / 2;
  const bodyTy = (size - bodyVB.height * bodyScale) / 2;

  const eyeVB = CURIOUS_EYES.sourceViewBox;
  const remapScale = Math.min(
    bodyVB.width / eyeVB.width,
    bodyVB.height / eyeVB.height,
  );
  const remapTx =
    URCHIN_BODY.faceCenter.x - CURIOUS_EYES.eyeCenter.x * remapScale;
  const remapTy =
    URCHIN_BODY.faceCenter.y - CURIOUS_EYES.eyeCenter.y * remapScale;

  const composedScale = bodyScale * remapScale;
  const composedTx = bodyScale * remapTx + bodyTx;
  const composedTy = bodyScale * remapTy + bodyTy;

  return {
    bodyTransform: `matrix(${bodyScale},0,0,${bodyScale},${bodyTx},${bodyTy})`,
    eyeTransform: `matrix(${composedScale},0,0,${composedScale},${composedTx},${composedTy})`,
    eyeCenterX:
      bodyScale * (remapTx + CURIOUS_EYES.eyeCenter.x * remapScale) + bodyTx,
    eyeCenterY:
      bodyScale * (remapTy + CURIOUS_EYES.eyeCenter.y * remapScale) + bodyTy,
  };
}

/**
 * The teal curious urchin, with the avatar family's idle animations:
 *   - Breathing: continuous 4s scale pulse (CSS keyframe)
 *   - Blink: random eye scaleY squish with a quick first "hello" wink after
 *     mount, 20% double-blink
 *   - Twitch: random 8-15s body rotation wobble (±1-2°)
 *
 * All animations are suppressed under `prefers-reduced-motion: reduce`.
 */
export function PeekCharacter({ size }: { size: number }) {
  const [isBlinking, setIsBlinking] = useState(false);
  const [twitchAngle, setTwitchAngle] = useState(0);
  const mountedRef = useRef(true);
  const reduceMotion = usePrefersReducedMotion();

  const { bodyTransform, eyeTransform, eyeCenterX, eyeCenterY } =
    computeLayout(size);

  useEffect(() => {
    if (reduceMotion) {
      return;
    }
    mountedRef.current = true;
    let timer: ReturnType<typeof setTimeout>;

    function scheduleBlink(isFirst = false) {
      const [minDelay, maxDelay] = isFirst ? [400, 1200] : [3000, 7000];
      timer = setTimeout(
        () => {
          if (!mountedRef.current) {
            return;
          }
          setIsBlinking(true);
          timer = setTimeout(() => {
            if (!mountedRef.current) {
              return;
            }
            setIsBlinking(false);
            if (Math.random() < 0.2) {
              timer = setTimeout(() => {
                if (!mountedRef.current) {
                  return;
                }
                setIsBlinking(true);
                timer = setTimeout(() => {
                  if (!mountedRef.current) {
                    return;
                  }
                  setIsBlinking(false);
                  scheduleBlink();
                }, 150);
              }, 200);
            } else {
              scheduleBlink();
            }
          }, 150);
        },
        randomBetween(minDelay, maxDelay),
      );
    }

    scheduleBlink(true);
    return () => {
      mountedRef.current = false;
      clearTimeout(timer);
      setIsBlinking(false);
    };
  }, [reduceMotion]);

  useEffect(() => {
    if (reduceMotion) {
      return;
    }
    mountedRef.current = true;
    let timer: ReturnType<typeof setTimeout>;

    function scheduleTwitch() {
      timer = setTimeout(
        () => {
          if (!mountedRef.current) {
            return;
          }
          setTwitchAngle((Math.random() < 0.5 ? -1 : 1) * randomBetween(1, 2));
          timer = setTimeout(() => {
            if (!mountedRef.current) {
              return;
            }
            setTwitchAngle(0);
            scheduleTwitch();
          }, 200);
        },
        randomBetween(8000, 15000),
      );
    }

    scheduleTwitch();
    return () => {
      mountedRef.current = false;
      clearTimeout(timer);
      setTwitchAngle(0);
    };
  }, [reduceMotion]);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="docs-peek-character"
      style={{
        transformOrigin: "center",
        // The body reaches the viewBox edges, so the idle twitch rotation
        // draws past them and would otherwise be clipped flat.
        overflow: "visible",
      }}
    >
      <g
        style={{
          transform: `rotate(${twitchAngle}deg)`,
          transformOrigin: `${size / 2}px ${size / 2}px`,
          transition: reduceMotion
            ? "none"
            : twitchAngle !== 0
              ? "transform 0.2s ease-in-out"
              : "transform 0.3s ease-out",
        }}
      >
        <path d={URCHIN_BODY.svgPath} fill={TEAL} transform={bodyTransform} />
      </g>
      <g
        style={{
          transform: isBlinking ? "scaleY(0.1)" : "scaleY(1)",
          transformOrigin: `${eyeCenterX}px ${eyeCenterY}px`,
          transition: reduceMotion ? "none" : "transform 0.15s ease-in-out",
        }}
      >
        {CURIOUS_EYES.paths.map((p, i) => (
          <path key={i} d={p.svgPath} fill={p.color} transform={eyeTransform} />
        ))}
      </g>
      <style>{`
        @keyframes docs-peek-breathe {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.03); }
        }
        @media (prefers-reduced-motion: no-preference) {
          .docs-peek-character {
            animation: docs-peek-breathe 4s ease-in-out infinite;
          }
        }
      `}</style>
    </svg>
  );
}
