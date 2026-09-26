"use client";

import { useEffect } from "react";
import { motion, useSpring, useTransform } from "motion/react";

/** A number that springs to its new value. `format` turns the raw value into text. */
export function AnimatedNumber({
  value,
  format,
  className,
  stiffness = 90,
  damping = 20,
}: {
  value: number;
  format: (v: number) => string;
  className?: string;
  stiffness?: number;
  damping?: number;
}) {
  const spring = useSpring(value, { stiffness, damping, mass: 0.8 });
  const text = useTransform(spring, (v) => format(v));
  useEffect(() => {
    spring.set(value);
  }, [spring, value]);
  return <motion.span className={className}>{text}</motion.span>;
}
