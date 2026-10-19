// Shared by the local publisher and the browser; no credentials are bundled here.
const encoder = new TextEncoder();
const CONTEXT = 'gbu-calculus-1-grades:v1';
export const RECORD_BYTES = 16384;
export const CATEGORIES = ['quiz', 'midterm', 'homework', 'final'];

export function encodeBase64(bytes) {
    return btoa(String.fromCharCode(...new Uint8Array(bytes)))
        .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeBase64(value, length) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
        throw new Error('Invalid encoding.');
    }
    const bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
    if (bytes.length !== length || encodeBase64(bytes) !== value) {
        throw new Error('Invalid length or encoding.');
    }
    return bytes;
}

export function parseCode(code) {
    if (typeof code !== 'string' || !/^C1-[A-Za-z0-9_-]{43}$/.test(code.trim())) {
        throw new Error('Invalid access code.');
    }
    return decodeBase64(code.trim().slice(3), 32);
}

export function createCode() {
    return `C1-${encodeBase64(crypto.getRandomValues(new Uint8Array(32)))}`;
}

export async function recordId(code) {
    const secret = parseCode(code);
    const input = new Uint8Array([...encoder.encode(`${CONTEXT}:lookup:`), ...secret]);
    const digest = await crypto.subtle.digest('SHA-256', input);
    return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
}

async function deriveKey(code, salt, usage) {
    const material = await crypto.subtle.importKey('raw', parseCode(code), 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        {name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode(CONTEXT)},
        material, {name: 'AES-GCM', length: 256}, false, [usage]
    );
}

function validateStudent(student) {
    if (!student || typeof student !== 'object' ||
        typeof student.student_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(student.student_id) ||
        typeof student.name !== 'string' || student.name.length > 120 ||
        !student.grades || typeof student.grades !== 'object' || Array.isArray(student.grades)) {
        throw new Error('Invalid student record.');
    }
    if (Object.keys(student).some(k => !['student_id', 'name', 'grades'].includes(k)) ||
        Object.keys(student.grades).some(k => !CATEGORIES.includes(k))) {
        throw new Error('Unknown student or grade fields.');
    }
    for (const category of CATEGORIES) {
        const grades = student.grades[category];
        if (!Array.isArray(grades) || grades.length > 100) throw new Error('Invalid grade category.');
        for (const grade of grades) {
            if (!grade || typeof grade !== 'object' ||
                typeof grade.label !== 'string' || !grade.label.trim() || grade.label.length > 120 ||
                !(grade.score === null || (typeof grade.score === 'number' && Number.isFinite(grade.score) && grade.score >= 0)) ||
                typeof grade.max_score !== 'number' || !Number.isFinite(grade.max_score) || grade.max_score <= 0 ||
                (grade.comment !== undefined && (typeof grade.comment !== 'string' || grade.comment.length > 500)) ||
                Object.keys(grade).some(k => !['label', 'score', 'max_score', 'comment'].includes(k))) {
                throw new Error('Invalid grade entry.');
            }
        }
    }
}

export function validateGradebook(book) {
    if (!book || !Array.isArray(book.students) || Object.keys(book).some(k => k !== 'students')) {
        throw new Error('Gradebook must contain a students array.');
    }
    const seen = new Set();
    for (const student of book.students) {
        validateStudent(student);
        if (seen.has(student.student_id)) throw new Error('Duplicate student ID.');
        seen.add(student.student_id);
    }
}

export async function encryptRecord(student, code, updatedAt) {
    validateStudent(student);
    const id = await recordId(code);
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const payload = encoder.encode(JSON.stringify({version: 1, course: 'Calculus I', updated_at: updatedAt, student}));
    if (payload.length > RECORD_BYTES) throw new Error('Student record exceeds the size limit.');
    // Equal-length padding avoids exposing the number of grades in a record.
    const padded = new Uint8Array(RECORD_BYTES).fill(32);
    padded.set(payload);
    const key = await deriveKey(code, salt, 'encrypt');
    const ciphertext = await crypto.subtle.encrypt(
        {name: 'AES-GCM', iv, additionalData: encoder.encode(`${CONTEXT}:${id}`), tagLength: 128}, key, padded
    );
    return {id, envelope: {version: 1, salt: encodeBase64(salt), iv: encodeBase64(iv), ciphertext: encodeBase64(ciphertext)}};
}

export async function decryptRecord(envelope, code) {
    if (!envelope || envelope.version !== 1) throw new Error('Unsupported record.');
    const salt = decodeBase64(envelope.salt, 32);
    const iv = decodeBase64(envelope.iv, 12);
    const ciphertext = decodeBase64(envelope.ciphertext, RECORD_BYTES + 16);
    const id = await recordId(code);
    const key = await deriveKey(code, salt, 'decrypt');
    const plaintext = await crypto.subtle.decrypt(
        {name: 'AES-GCM', iv, additionalData: encoder.encode(`${CONTEXT}:${id}`), tagLength: 128}, key, ciphertext
    );
    const record = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(plaintext));
    if (record.version !== 1 || record.course !== 'Calculus I' ||
        typeof record.updated_at !== 'string' || !Number.isFinite(Date.parse(record.updated_at))) {
        throw new Error('Invalid record.');
    }
    validateStudent(record.student);
    return record;
}
