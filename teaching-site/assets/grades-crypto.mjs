// Shared by the local publisher and the browser; no credentials are bundled here.
const encoder = new TextEncoder();
const CONTEXT = 'gbu-calculus-1-grades:v1';
export const RECORD_BYTES = 16384;
export const STAFF_RECORD_BYTES = 1024 * 1024;
export const CATEGORIES = ['quiz', 'midterm', 'homework', 'final'];
const STUDENT = {prefix: 'C1-', context: CONTEXT, bytes: RECORD_BYTES};
const STAFF = {prefix: 'C1T-', context: 'gbu-calculus-1-staff:v1', bytes: STAFF_RECORD_BYTES};

export function encodeBase64(bytes) {
    const data = new Uint8Array(bytes);
    let binary = '';
    for (let offset = 0; offset < data.length; offset += 32768) {
        binary += String.fromCharCode(...data.subarray(offset, offset + 32768));
    }
    return btoa(binary)
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

function parseSecret(code, scope) {
    if (typeof code !== 'string' || !new RegExp(`^${scope.prefix}[A-Za-z0-9_-]{43}$`).test(code.trim())) {
        throw new Error('Invalid access code.');
    }
    return decodeBase64(code.trim().slice(scope.prefix.length), 32);
}

export function parseCode(code) { return parseSecret(code, STUDENT); }
export function parseStaffCode(code) { return parseSecret(code, STAFF); }

export function createCode() {
    return `C1-${encodeBase64(crypto.getRandomValues(new Uint8Array(32)))}`;
}

export function createStaffCode() {
    return `C1T-${encodeBase64(crypto.getRandomValues(new Uint8Array(32)))}`;
}

async function scopedId(code, scope) {
    const secret = parseSecret(code, scope);
    const input = new Uint8Array([...encoder.encode(`${scope.context}:lookup:`), ...secret]);
    const digest = await crypto.subtle.digest('SHA-256', input);
    return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
}

export async function recordId(code) { return scopedId(code, STUDENT); }
export async function staffRecordId(code) { return scopedId(code, STAFF); }

async function deriveKey(code, salt, usage, scope) {
    const material = await crypto.subtle.importKey('raw', parseSecret(code, scope), 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        {name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode(scope.context)},
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
                !(grade.score === null ||
                    (typeof grade.score === 'number' && Number.isFinite(grade.score) && grade.score >= 0) ||
                    (typeof grade.score === 'string' && grade.score.trim().length > 0 && grade.score.length <= 32)) ||
                !(grade.max_score === null ||
                    (typeof grade.max_score === 'number' && Number.isFinite(grade.max_score) && grade.max_score > 0)) ||
                (typeof grade.score === 'string' && grade.max_score !== null) ||
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

async function seal(record, code, scope) {
    const id = await scopedId(code, scope);
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const payload = encoder.encode(JSON.stringify(record));
    if (payload.length > scope.bytes) throw new Error('Grade record exceeds the size limit.');
    // Equal-length padding avoids exposing the number of grades in a record.
    const padded = new Uint8Array(scope.bytes).fill(32);
    padded.set(payload);
    const key = await deriveKey(code, salt, 'encrypt', scope);
    const ciphertext = await crypto.subtle.encrypt(
        {name: 'AES-GCM', iv, additionalData: encoder.encode(`${scope.context}:${id}`), tagLength: 128}, key, padded
    );
    return {id, envelope: {version: 1, salt: encodeBase64(salt), iv: encodeBase64(iv), ciphertext: encodeBase64(ciphertext)}};
}

async function unseal(envelope, code, scope) {
    if (!envelope || envelope.version !== 1) throw new Error('Unsupported record.');
    const salt = decodeBase64(envelope.salt, 32);
    const iv = decodeBase64(envelope.iv, 12);
    const ciphertext = decodeBase64(envelope.ciphertext, scope.bytes + 16);
    const id = await scopedId(code, scope);
    const key = await deriveKey(code, salt, 'decrypt', scope);
    const plaintext = await crypto.subtle.decrypt(
        {name: 'AES-GCM', iv, additionalData: encoder.encode(`${scope.context}:${id}`), tagLength: 128}, key, ciphertext
    );
    const record = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(plaintext));
    if (record.version !== 1 || record.course !== 'Calculus I' ||
        typeof record.updated_at !== 'string' || !Number.isFinite(Date.parse(record.updated_at))) {
        throw new Error('Invalid record.');
    }
    return record;
}

export async function encryptRecord(student, code, updatedAt) {
    validateStudent(student);
    return seal({version: 1, course: 'Calculus I', updated_at: updatedAt, student}, code, STUDENT);
}

export async function decryptRecord(envelope, code) {
    const record = await unseal(envelope, code, STUDENT);
    validateStudent(record.student);
    return record;
}

function validateStaff(record) {
    if (Object.keys(record).some(k => !['version', 'course', 'updated_at', 'students', 'roster'].includes(k))) {
        throw new Error('Unknown staff record fields.');
    }
    validateGradebook({students: record.students});
    if (!Array.isArray(record.roster) || record.roster.length !== record.students.length) {
        throw new Error('Invalid class roster.');
    }
    const ids = new Set(record.students.map(s => s.student_id));
    for (const entry of record.roster) {
        if (!entry || !ids.delete(entry.student_id) || typeof entry.group !== 'string' || entry.group.length > 120 ||
            Object.keys(entry).some(k => !['student_id', 'group'].includes(k))) throw new Error('Invalid class roster entry.');
    }
}

export async function encryptStaffRecord(data, code, updatedAt) {
    const record = {version: 1, course: 'Calculus I', updated_at: updatedAt, students: data.students, roster: data.roster};
    validateStaff(record);
    return seal(record, code, STAFF);
}

export async function decryptStaffRecord(envelope, code) {
    const record = await unseal(envelope, code, STAFF);
    validateStaff(record);
    return record;
}
