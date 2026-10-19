import {CATEGORIES} from './grades-crypto.mjs?v=3';

export function assessments(students) {
    const result = [];
    for (const category of CATEGORIES) {
        const labels = new Set(students.flatMap(s => s.grades[category].map(g => g.label)));
        for (const label of labels) {
            if (students.some(s => s.grades[category].some(g => g.label === label && g.score !== null))) {
                result.push({category, label, key: JSON.stringify([category, label])});
            }
        }
    }
    return result;
}

export function gradeFor(student, assessment) {
    return student.grades[assessment.category].find(grade => grade.label === assessment.label)?.score ?? null;
}

export function summarize(students, assessment) {
    const values = students.map(s => gradeFor(s, assessment));
    const numeric = values.filter(value => typeof value === 'number');
    const np = values.filter(value => value === 'NP').length;
    const unrecorded = values.filter(value => value === null).length;
    const sorted = numeric.toSorted((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return {
        total: students.length, np, unrecorded, recorded: values.length - np - unrecorded,
        numericCount: numeric.length,
        mean: numeric.length ? numeric.reduce((sum, value) => sum + value, 0) / numeric.length : null,
        median: sorted.length ? (sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2) : null,
        min: sorted.length ? sorted[0] : null, max: sorted.length ? sorted.at(-1) : null
    };
}

export function distribution(students, assessment) {
    const values = students.map(s => gradeFor(s, assessment)).filter(value => typeof value === 'number');
    if (!values.length) return [];
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (values.every(Number.isInteger) && max <= 20) {
        return Array.from({length: max + 1}, (_, score) => ({label: String(score), count: values.filter(v => v === score).length}));
    }
    if (min === max) return [{label: String(min), count: values.length}];
    const bins = Array.from({length: 10}, (_, index) => {
        const low = min + (max - min) * index / 10;
        const high = min + (max - min) * (index + 1) / 10;
        return {label: `${Number(low.toFixed(1))}-${Number(high.toFixed(1))}`, count: 0};
    });
    for (const value of values) bins[Math.min(9, Math.floor((value - min) / (max - min) * 10))].count++;
    return bins;
}
