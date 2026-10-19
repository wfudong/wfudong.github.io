import {CATEGORIES, decryptRecord, parseCode, recordId} from './grades-crypto.mjs';

const messages = {
    en: {
        course: 'Calculus I', studentPortal: 'STUDENT PORTAL', title: 'My Grades',
        intro: 'View your quiz, midterm, homework, and final exam scores using the private access code from your instructor.',
        unlockHeading: 'Open your grade record', codeHelp: 'Paste the complete code beginning with C1-. Keep it private: anyone with your code can open your record.',
        codeLabel: 'Your private access code', unlock: 'View my grades', privateRecord: 'YOUR PRIVATE RECORD', lock: 'Lock and clear',
        scoreNote: 'A dash means the score has not been published. Scores are shown as earned / possible; no weighted course total is calculated here.',
        privacyHeading: 'Keep your record private',
        privacy: 'Your code is used in this browser and is not submitted to a login server or saved by this page. The page clears your record when you switch tabs or after five minutes without activity. Use “Lock and clear” before leaving a shared computer.',
        help: 'Lost code or an incorrect score? Contact your instructor privately. Never post your code in a group chat.',
        footer: 'Individual grade access', loading: 'Opening your encrypted record...',
        failure: 'Unable to open a record. Check your complete code and connection, or ask your instructor whether grades have been published.',
        locked: 'Your record has been locked and cleared.',
        unavailable: 'Secure decryption is unavailable. Open this page directly over HTTPS in a current browser, outside embedded frames.',
        quiz: 'Quizzes', midterm: 'Midterm', homework: 'Homework', final: 'Final Exam',
        assessment: 'Assessment', score: 'Score', empty: 'No scores published yet.', student: 'Student ID', updated: 'Last published'
    },
    zh: {
        course: '高等数学（一）', studentPortal: '学生成绩查询', title: '我的成绩',
        intro: '使用教师单独发放的查询码，查看自己的测验、期中、作业与期末成绩。',
        unlockHeading: '打开个人成绩单', codeHelp: '请粘贴以 C1- 开头的完整查询码。请妥善保管：持有此码的人可以查看你的成绩。',
        codeLabel: '个人成绩查询码', unlock: '查看我的成绩', privateRecord: '个人成绩单', lock: '锁定并清除',
        scoreNote: '横线表示成绩尚未发布。成绩以“得分 / 满分”显示，本页不计算加权总评。',
        privacyHeading: '保护你的个人成绩',
        privacy: '查询码仅在当前浏览器中使用，不会提交给登录服务器或由本页保存。切换标签页或五分钟无操作后，成绩会自动清除。离开公用电脑前，请点击“锁定并清除”。',
        help: '查询码遗失或成绩有疑问？请私下联系教师。请勿在群聊中发送查询码。',
        footer: '个人成绩查询', loading: '正在解密你的成绩单……',
        failure: '无法打开成绩单。请检查完整查询码及网络连接，或联系教师确认成绩是否已发布。',
        locked: '成绩单已锁定并清除。', unavailable: '无法使用安全解密功能。请通过 HTTPS 在较新的浏览器中直接打开本页，不要在嵌入框架中打开。',
        quiz: '测验', midterm: '期中考试', homework: '作业', final: '期末考试',
        assessment: '考核项目', score: '成绩', empty: '暂未发布成绩。', student: '学号', updated: '最近发布'
    }
};

let language = new URLSearchParams(location.search).get('lang') === 'zh' ? 'zh' : 'en';
let currentRecord = null;
let request = null;
let generation = 0;
let lockTimer;
let statusKey = '';
const form = document.querySelector('#unlock-form');
const input = document.querySelector('#access-code');
const button = document.querySelector('#unlock-button');
const unlockPanel = document.querySelector('#unlock-panel');
const gradesPanel = document.querySelector('#grades-panel');
const status = document.querySelector('#status');
const categories = document.querySelector('#grade-categories');
const canDecrypt = globalThis.isSecureContext && Boolean(globalThis.crypto?.subtle) && window.top === window.self;

function setStatus(key, error = false) {
    statusKey = key;
    status.textContent = key ? messages[language][key] : '';
    status.classList.toggle('error', error);
}

function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
}

function renderRecord() {
    const text = messages[language];
    const student = currentRecord.student;
    document.querySelector('#record-heading').textContent = student.name || student.student_id;
    document.querySelector('#student-id').textContent = `${text.student}: ${student.student_id}`;
    document.querySelector('#updated-at').textContent = `${text.updated}: ${new Date(currentRecord.updated_at).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-GB')}`;
    categories.replaceChildren();
    for (const category of CATEGORIES) {
        const section = element('section', undefined, 'grade-category');
        section.append(element('h3', text[category]));
        const grades = student.grades[category];
        if (!grades.length) {
            section.append(element('p', text.empty, 'muted'));
        } else {
            const table = element('table');
            const heading = element('tr');
            for (const label of [text.assessment, text.score]) {
                const cell = element('th', label);
                cell.scope = 'col';
                heading.append(cell);
            }
            const head = element('thead');
            head.append(heading);
            const body = element('tbody');
            for (const grade of grades) {
                const row = element('tr');
                const label = element('td', grade.label);
                if (grade.comment) label.append(element('span', grade.comment, 'grade-comment'));
                row.append(label, element('td', `${grade.score === null ? '\u2014' : grade.score} / ${grade.max_score}`));
                body.append(row);
            }
            table.append(head, body);
            section.append(table);
        }
        categories.append(section);
    }
}

function translate() {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    document.title = `Calculus I · ${messages[language].title}`;
    for (const node of document.querySelectorAll('[data-text]')) node.textContent = messages[language][node.dataset.text];
    document.querySelector('#course-link').href = language === 'zh' ? 'calculus-1-zh.html' : 'calculus-1.html';
    const toggle = document.querySelector('#language-toggle');
    toggle.textContent = language === 'zh' ? 'EN' : '中文';
    toggle.lang = language === 'zh' ? 'en' : 'zh-CN';
    if (statusKey) status.textContent = messages[language][statusKey];
    if (currentRecord) renderRecord();
}

function resetTimer() {
    clearTimeout(lockTimer);
    if (currentRecord) lockTimer = setTimeout(() => lock(), 5 * 60 * 1000);
}

function lock(focus = false) {
    generation++;
    request?.abort();
    request = null;
    clearTimeout(lockTimer);
    currentRecord = null;
    input.value = '';
    categories.replaceChildren();
    for (const id of ['record-heading', 'student-id', 'updated-at']) document.getElementById(id).textContent = '';
    gradesPanel.hidden = true;
    unlockPanel.hidden = false;
    button.disabled = !canDecrypt;
    setStatus('locked');
    if (focus) input.focus();
}

form.addEventListener('submit', async event => {
    event.preventDefault();
    if (button.disabled) return;
    let code = input.value.trim();
    input.value = '';
    const attempt = ++generation;
    request?.abort();
    request = new AbortController();
    button.disabled = true;
    setStatus('loading');
    try {
        parseCode(code);
        const id = await recordId(code);
        if (attempt !== generation) return;
        // Only an opaque lookup hash leaves the browser; never the code or student ID.
        const response = await fetch(`grades-data/calculus-1/${id}.json`, {
            cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
            redirect: 'error', signal: request.signal
        });
        if (!response.ok) throw new Error('Record unavailable.');
        const serialized = await response.text();
        if (serialized.length > 24000) throw new Error('Invalid record.');
        const record = await decryptRecord(JSON.parse(serialized), code);
        if (attempt !== generation || document.hidden) return;
        currentRecord = record;
        renderRecord();
        unlockPanel.hidden = true;
        gradesPanel.hidden = false;
        setStatus('');
        resetTimer();
        document.querySelector('#record-heading').focus();
    } catch {
        if (attempt === generation) setStatus('failure', true);
    } finally {
        code = '';
        if (attempt === generation) {
            button.disabled = false;
            request = null;
        }
    }
});

document.querySelector('#lock-button').addEventListener('click', () => lock(true));
document.querySelector('#language-toggle').addEventListener('click', () => {
    language = language === 'en' ? 'zh' : 'en';
    translate();
});
for (const event of ['pointerdown', 'keydown', 'scroll']) document.addEventListener(event, resetTimer, {passive: true});
document.addEventListener('visibilitychange', () => { if (document.hidden) lock(); });
window.addEventListener('pagehide', () => lock());
window.addEventListener('pageshow', event => { if (event.persisted) lock(); });
translate();
if (!canDecrypt) {
    setStatus('unavailable', true);
} else {
    button.disabled = false;
}
