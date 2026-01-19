/**
 * Formula evaluation handler for spreadsheet calculations.
 * Provides basic formula support - in production, use HyperFormula.
 *
 * @module websocket/formula-handler
 */

import {
  formulaCalculationsTotal,
  formulaCalculationDuration,
} from '../shared/metrics.js';

/**
 * Evaluates simple spreadsheet formulas.
 * Supports basic SUM function and arithmetic expressions.
 * This is a demo implementation - production systems should use HyperFormula.
 *
 * @param value - The cell value (may or may not be a formula)
 * @returns The computed result, or the original value if not a formula
 */
export function evaluateFormula(value: string): string {
  // If not a formula, return as-is
  if (!value || !value.startsWith('=')) {
    return value;
  }

  // Record formula calculation metrics
  formulaCalculationsTotal.inc();
  const start = Date.now();

  try {
    const result = evaluateFormulaExpression(value);
    formulaCalculationDuration.observe(Date.now() - start);
    return result;
  } catch {
    formulaCalculationDuration.observe(Date.now() - start);
    return '#ERROR';
  }
}

/**
 * Internal formula expression evaluator.
 * Handles the actual computation of formula expressions.
 *
 * @param formula - The formula string starting with '='
 * @returns The computed result as a string
 * @throws Error if evaluation fails
 */
function evaluateFormulaExpression(formula: string): string {
  // Remove the = prefix
  const expr = formula.slice(1).toUpperCase();

  // Handle SUM function, e.g., =SUM(1,2,3)
  if (expr.startsWith('SUM(') && expr.endsWith(')')) {
    return evaluateSum(expr);
  }

  // Handle AVERAGE function, e.g., =AVERAGE(1,2,3)
  if (expr.startsWith('AVERAGE(') && expr.endsWith(')')) {
    return evaluateAverage(expr);
  }

  // Handle COUNT function, e.g., =COUNT(1,2,3)
  if (expr.startsWith('COUNT(') && expr.endsWith(')')) {
    return evaluateCount(expr);
  }

  // Handle MIN function, e.g., =MIN(1,2,3)
  if (expr.startsWith('MIN(') && expr.endsWith(')')) {
    return evaluateMin(expr);
  }

  // Handle MAX function, e.g., =MAX(1,2,3)
  if (expr.startsWith('MAX(') && expr.endsWith(')')) {
    return evaluateMax(expr);
  }

  // Handle simple arithmetic (unsafe in production - use proper parser)
  const result = Function(`"use strict"; return (${formula.slice(1)})`)();
  return String(result);
}

/**
 * Evaluates a SUM function.
 *
 * @param expr - The SUM expression, e.g., "SUM(1,2,3)"
 * @returns The sum as a string
 */
function evaluateSum(expr: string): string {
  const inner = expr.slice(4, -1);
  const nums = parseNumberList(inner);
  return nums.reduce((a, b) => a + b, 0).toString();
}

/**
 * Evaluates an AVERAGE function.
 *
 * @param expr - The AVERAGE expression, e.g., "AVERAGE(1,2,3)"
 * @returns The average as a string
 */
function evaluateAverage(expr: string): string {
  const inner = expr.slice(8, -1);
  const nums = parseNumberList(inner);
  if (nums.length === 0) return '#DIV/0!';
  const sum = nums.reduce((a, b) => a + b, 0);
  return (sum / nums.length).toString();
}

/**
 * Evaluates a COUNT function.
 *
 * @param expr - The COUNT expression, e.g., "COUNT(1,2,3)"
 * @returns The count as a string
 */
function evaluateCount(expr: string): string {
  const inner = expr.slice(6, -1);
  const nums = parseNumberList(inner);
  return nums.length.toString();
}

/**
 * Evaluates a MIN function.
 *
 * @param expr - The MIN expression, e.g., "MIN(1,2,3)"
 * @returns The minimum value as a string
 */
function evaluateMin(expr: string): string {
  const inner = expr.slice(4, -1);
  const nums = parseNumberList(inner);
  if (nums.length === 0) return '#VALUE!';
  return Math.min(...nums).toString();
}

/**
 * Evaluates a MAX function.
 *
 * @param expr - The MAX expression, e.g., "MAX(1,2,3)"
 * @returns The maximum value as a string
 */
function evaluateMax(expr: string): string {
  const inner = expr.slice(4, -1);
  const nums = parseNumberList(inner);
  if (nums.length === 0) return '#VALUE!';
  return Math.max(...nums).toString();
}

/**
 * Parses a comma-separated list of numbers.
 *
 * @param input - Comma-separated string of numbers
 * @returns Array of parsed numbers (NaN values filtered out)
 */
function parseNumberList(input: string): number[] {
  return input
    .split(',')
    .map(n => parseFloat(n.trim()))
    .filter(n => !isNaN(n));
}
