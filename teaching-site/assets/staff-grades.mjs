import {decryptStaffRecord, parseStaffCode, staffRecordId} from './grades-crypto.mjs?v=3';
import {assessments, distribution, gradeFor, summarize} from './grade-statistics.mjs';

const messages = {
    en: {
        course: 'Calculus I', studentView: 'Student view', eyebrow: 'CALCULUS I / TEACHING TEAM', title: 'The Class at a Glance',
        intro: 'An encrypted workspace for teachers and TAs: individual results, participation, and class-wide patterns.', seal: 'STAFF ACCESS ONLY',
        unlockHeading: 'Open the teaching dashboard', codeHelp: 'Use the master code beginning with C1T-. It grants access to all class grades. Share it only with authorized teaching staff.',
        masterCode: 'Teacher / TA master code', unlock: 'Unlock dashboard', overview: 'Class Overview', lock: 'Lock and clear', group: 'Group', assessment: 'Assessment',
        npNote: 'NP = not presented, not zero. Numeric averages include actual zero scores and exclude NP, letter marks, and unrecorded results. No weighted totals are inferred.',
        distribution: 'Score Distribution', distributionNote: 'Selected assessment. Numeric scores only; NP is counted separately above.',
        quizMeans: 'Quiz Averages', quizMeansNote: 'Raw scores as recorded, with the numeric sample size beside each mean. Scales may differ between quizzes.',
        homework: 'Homework Participation', homeworkNote: 'Recorded marks, NP, and unrecorded results remain distinct.',
        roster: 'Student Gradebook', search: 'Find by name or student ID', npOnly: 'Only NP in the selected assessment',
        tableNote: 'Charts follow the group filter. Search and the NP checkbox filter the table only. Entirely unrecorded assessments are omitted.',
        privacyHeading: 'Protect the whole class', privacy: 'The master code is used only in this browser and is not saved by this page. The dashboard locks when you switch tabs or after five minutes of inactivity. Anyone holding the code can view the full class record.',
        footer: 'Confidential teaching records', allGroups: 'All groups', ungrouped: 'Ungrouped', student: 'Student ID', name: 'Name',
        students: 'Students in group', recorded: 'Recorded results', notPresented: 'NP / Not presented', mean: 'Mean numeric score',
        noData: 'No numeric results to chart.', noHomework: 'No homework results recorded yet.', unrecorded: 'Not yet recorded',
        loading: 'Decrypting the class record...', failure: 'Unable to open the dashboard. Check the full master code, connection, and publication status.',
        locked: 'Dashboard locked and cleared.', unavailable: 'Open this page directly over HTTPS in a current browser, outside embedded frames.',
        updated: 'Last published', rows: 'students shown', noAssessment: 'No recorded assessments', noRows: 'No students match these filters.'
    },
    zh: {
        course: '高等数学（一）', studentView: '学生查询', eyebrow: '高等数学（一） / 教学团队', title: '全班成绩概览',
        intro: '供教师与助教使用的加密工作区：查看个人成绩、参与情况及全班成绩分布。', seal: '仅供教学团队使用',
        unlockHeading: '打开教学仪表盘', codeHelp: '请输入以 C1T- 开头的主查询码。持有此码可以查看全班成绩，请仅与获授权的教师和助教分享。',
        masterCode: '教师 / 助教主查询码', unlock: '解锁仪表盘', overview: '班级概览', lock: '锁定并清除', group: '分组', assessment: '考核项目',
        npNote: 'NP 表示未参加或未提交，不等于 0 分。数字平均分包含实际 0 分，排除 NP、字母成绩和尚未记录的项目。本页不推算加权总评。',
        distribution: '成绩分布', distributionNote: '按所选考核项目统计数字成绩；NP 在上方单独计数。',
        quizMeans: '测验平均分', quizMeansNote: '显示原始分数平均值及数字成绩人数 n。不同测验的评分尺度可能不同。',
        homework: '作业参与情况', homeworkNote: '分别显示已记录的成绩、NP 与尚未记录的项目。',
        roster: '学生成绩册', search: '按姓名或学号查找', npOnly: '仅显示所选考核项目为 NP 的学生',
        tableNote: '图表按分组筛选。搜索及 NP 选项仅筛选下方成绩表。完全未记录的考核项目不显示。',
        privacyHeading: '保护全班学生的信息', privacy: '主查询码仅在当前浏览器中使用，本页不会保存。切换标签页或五分钟无操作后自动锁定。持有此码的人可以查看全班成绩。',
        footer: '保密教学记录', allGroups: '全部分组', ungrouped: '未分组', student: '学号', name: '姓名',
        students: '当前分组学生数', recorded: '已记录成绩', notPresented: 'NP / 未参加或未提交', mean: '数字成绩平均分',
        noData: '暂无可绘制的数字成绩。', noHomework: '暂无作业记录。', unrecorded: '尚未记录',
        loading: '正在解密全班成绩……', failure: '无法打开仪表盘。请检查完整主查询码、网络连接及发布状态。',
        locked: '仪表盘已锁定并清除。', unavailable: '请通过 HTTPS 在较新的浏览器中直接打开本页，不要在嵌入框架中打开。',
        updated: '最近发布', rows: '名学生显示', noAssessment: '暂无考核记录', noRows: '没有符合筛选条件的学生。'
    }
};

let language = new URLSearchParams(location.search).get('lang') === 'zh' ? 'zh' : 'en';
let record = null;
let groups = new Map();
let available = [];
let generation = 0;
let request;
let timer;
let statusKey = '';
const $ = selector => document.querySelector(selector);
const canDecrypt = globalThis.isSecureContext && Boolean(globalThis.crypto?.subtle) && window.top === window.self;
const format = value => value === null ? '\u2014' : Number(value.toFixed(2)).toString();

function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
}

function svgNode(tag, attributes = {}, text) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    if (text !== undefined) element.textContent = text;
    return element;
}

function setStatus(key, error = false) {
    statusKey = key;
    $('#status').textContent = key ? messages[language][key] : '';
    $('#status').classList.toggle('error', error);
}

function filteredStudents() {
    const selection = $('#group-filter').value;
    return selection === '' ? record.students : record.students.filter(s => groups.get(s.student_id) === JSON.parse(selection));
}

function selectedAssessment() { return available.find(a => a.key === $('#assessment-filter').value); }

function populateFilters() {
    const previousGroup = $('#group-filter').value;
    const previousAssessment = $('#assessment-filter').value;
    const groupSelect = $('#group-filter');
    groupSelect.replaceChildren();
    const all = node('option', messages[language].allGroups);
    all.value = '';
    groupSelect.append(all);
    for (const group of new Set(record.roster.map(entry => entry.group))) {
        const option = node('option', group || messages[language].ungrouped);
        option.value = JSON.stringify(group);
        groupSelect.append(option);
    }
    groupSelect.value = previousGroup;
    if (groupSelect.selectedIndex < 0) groupSelect.selectedIndex = 0;
    const assessmentSelect = $('#assessment-filter');
    assessmentSelect.replaceChildren();
    for (const assessment of available) {
        const option = node('option', assessment.label);
        option.value = assessment.key;
        assessmentSelect.append(option);
    }
    if (!available.length) assessmentSelect.append(node('option', messages[language].noAssessment));
    if (available.some(a => a.key === previousAssessment)) assessmentSelect.value = previousAssessment;
}

function bars(target, items, title, colorClass = 'bar') {
    target.replaceChildren();
    if (!items.length) { target.append(node('p', messages[language].noData, 'muted')); return; }
    const width = 600, height = 260, left = 42, right = 16, top = 35, bottom = 50;
    const highest = Math.max(1, ...items.map(item => item.value));
    const ticks = colorClass === 'bar' ? Math.min(4, Math.ceil(highest)) : 4;
    const max = colorClass === 'bar' ? Math.ceil(highest / ticks) * ticks : highest;
    const plotHeight = height - top - bottom;
    const slot = (width - left - right) / items.length;
    const svg = svgNode('svg', {viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `${title}: ${items.map(i => `${i.label}: ${i.detail ?? format(i.value)}`).join('; ')}`});
    svg.append(svgNode('title', {}, title));
    for (let tick = 0; tick <= ticks; tick++) {
        const y = top + plotHeight * tick / ticks;
        svg.append(svgNode('line', {x1: left, x2: width - right, y1: y, y2: y, class: 'grid-line'}));
        svg.append(svgNode('text', {x: left - 7, y: y + 4, 'text-anchor': 'end'}, format(max * (ticks - tick) / ticks)));
    }
    items.forEach((item, index) => {
        const barHeight = plotHeight * item.value / max;
        const x = left + slot * index + slot * .15;
        const y = top + plotHeight - barHeight;
        const bar = svgNode('rect', {x, y, width: slot * .7, height: barHeight, rx: 4, class: colorClass});
        bar.append(svgNode('title', {}, `${item.label}: ${item.detail ?? format(item.value)}`));
        svg.append(bar);
        svg.append(svgNode('text', {x: x + slot * .35, y: y - 8, 'text-anchor': 'middle', class: 'bar-label'}, item.detail ?? format(item.value)));
        svg.append(svgNode('text', {x: x + slot * .35, y: height - bottom + 22, 'text-anchor': 'middle'}, item.label));
    });
    target.append(svg);
}

function homeworkChart(students) {
    const target = $('#homework-chart');
    target.replaceChildren();
    const homework = available.filter(a => a.category === 'homework');
    if (!homework.length) { target.append(node('p', messages[language].noHomework, 'muted')); return; }
    const text = messages[language];
    const svg = svgNode('svg', {viewBox: `0 0 900 ${homework.length * 70 + 5}`, role: 'img', 'aria-label': text.homework});
    homework.forEach((assessment, index) => {
        const summary = summarize(students, assessment);
        const y = index * 70;
        svg.append(svgNode('text', {x: 0, y: y + 40}, assessment.label));
        const detail = `${text.recorded}: ${summary.recorded} | NP: ${summary.np} | ${text.unrecorded}: ${summary.unrecorded}`;
        svg.append(svgNode('text', {x: 125, y: y + 17}, detail));
        let x = 125;
        for (const [count, className] of [[summary.recorded, 'recorded-bar'], [summary.np, 'np-bar'], [summary.unrecorded, 'unrecorded-bar']]) {
            const width = summary.total ? 750 * count / summary.total : 0;
            const bar = svgNode('rect', {x, y: y + 27, width, height: 23, rx: 2, class: className});
            bar.append(svgNode('title', {}, `${assessment.label}: ${detail}`));
            svg.append(bar);
            x += width;
        }
    });
    const legend = node('div', undefined, 'chart-legend');
    legend.append(node('span', text.recorded, 'legend-item'), node('span', 'NP', 'legend-item legend-np'), node('span', text.unrecorded, 'legend-item legend-unrecorded'));
    target.append(svg, legend);
}

function renderTable() {
    const text = messages[language];
    const search = $('#student-search').value.trim().toLocaleLowerCase();
    const selected = selectedAssessment();
    const students = filteredStudents().filter(student => {
        const matches = `${student.student_id} ${student.name}`.toLocaleLowerCase().includes(search);
        return matches && (!$('#np-only').checked || selected && gradeFor(student, selected) === 'NP');
    });
    $('#row-count').textContent = `${students.length} ${text.rows}`;
    const table = node('table');
    const head = node('thead');
    const heading = node('tr');
    for (const label of [text.student, text.name, text.group, ...available.map(a => a.label)]) {
        const cell = node('th', label);
        cell.scope = 'col';
        heading.append(cell);
    }
    head.append(heading);
    const body = node('tbody');
    for (const student of students) {
        const row = node('tr');
        row.append(node('td', student.student_id), node('td', student.name), node('td', groups.get(student.student_id) || text.ungrouped));
        for (const assessment of available) {
            const grade = gradeFor(student, assessment);
            const cell = node('td', grade === null ? '\u2014' : String(grade), grade === 'NP' ? 'np-mark' : grade === null ? 'empty-result' : undefined);
            if (grade === 'NP') cell.title = text.notPresented;
            row.append(cell);
        }
        body.append(row);
    }
    if (!students.length) {
        const cell = node('td', text.noRows);
        cell.colSpan = available.length + 3;
        const row = node('tr'); row.append(cell); body.append(row);
    }
    table.append(head, body);
    $('#grade-table').replaceChildren(table);
    $('#grade-table').setAttribute('aria-label', text.roster);
}

function render() {
    if (!record) return;
    const text = messages[language];
    const students = filteredStudents();
    const selected = selectedAssessment();
    const summary = selected ? summarize(students, selected) : {recorded: 0, np: 0, mean: null};
    $('#updated-at').textContent = `${text.updated}: ${new Date(record.updated_at).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-GB')}`;
    $('#metrics').replaceChildren();
    for (const [label, value, className] of [[text.students, students.length, 'metric'], [text.recorded, summary.recorded, 'metric'], [text.notPresented, summary.np, 'metric metric-np'], [text.mean, format(summary.mean), 'metric']]) {
        const metric = node('article', undefined, className);
        metric.append(node('p', label), node('strong', String(value)));
        $('#metrics').append(metric);
    }
    const histogram = selected ? distribution(students, selected).map(bin => ({label: bin.label, value: bin.count})) : [];
    bars($('#distribution-chart'), histogram, selected?.label ?? text.distribution);
    const means = available.filter(a => a.category === 'quiz').map(a => ({assessment: a, summary: summarize(students, a)}))
        .filter(entry => entry.summary.mean !== null)
        .map(({assessment, summary: stats}) => ({label: assessment.label, value: stats.mean, detail: `${format(stats.mean)} (n=${stats.numericCount})`}));
    bars($('#quiz-chart'), means, text.quizMeans, 'quiz-bar');
    homeworkChart(students);
    renderTable();
}

function translate() {
    const text = messages[language];
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    document.title = `Calculus I · ${text.overview}`;
    for (const element of document.querySelectorAll('[data-text]')) element.textContent = text[element.dataset.text];
    $('#course-link').href = language === 'zh' ? 'calculus-1-zh.html' : 'calculus-1.html';
    $('#language-toggle').textContent = language === 'zh' ? 'EN' : '中文';
    $('#language-toggle').lang = language === 'zh' ? 'en' : 'zh-CN';
    if (statusKey) $('#status').textContent = text[statusKey];
    if (record) { populateFilters(); render(); }
}

function resetTimer() {
    clearTimeout(timer);
    if (record) timer = setTimeout(() => lock(), 5 * 60 * 1000);
}

function lock(focus = false) {
    generation++;
    request?.abort(); request = null;
    clearTimeout(timer);
    record = null; groups.clear(); available = [];
    $('#master-code').value = ''; $('#student-search').value = ''; $('#np-only').checked = false;
    for (const id of ['group-filter', 'assessment-filter', 'metrics', 'distribution-chart', 'quiz-chart', 'homework-chart', 'grade-table', 'row-count', 'updated-at']) $(`#${id}`).replaceChildren();
    $('#dashboard').hidden = true; $('#unlock-panel').hidden = false;
    $('#unlock-button').disabled = !canDecrypt;
    setStatus('locked');
    if (focus) $('#master-code').focus();
}

$('#unlock-form').addEventListener('submit', async event => {
    event.preventDefault();
    if ($('#unlock-button').disabled) return;
    let code = $('#master-code').value.trim();
    $('#master-code').value = '';
    const attempt = ++generation;
    request?.abort(); request = new AbortController();
    $('#unlock-button').disabled = true; setStatus('loading');
    try {
        parseStaffCode(code);
        const id = await staffRecordId(code);
        if (attempt !== generation) return;
        const response = await fetch(`grades-data/calculus-1-staff/${id}.json`, {
            cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: request.signal
        });
        if (!response.ok) throw new Error('Unavailable staff record.');
        const serialized = await response.text();
        if (serialized.length > 1500000) throw new Error('Invalid staff record.');
        const decrypted = await decryptStaffRecord(JSON.parse(serialized), code);
        if (attempt !== generation || document.hidden) return;
        record = decrypted;
        groups = new Map(record.roster.map(entry => [entry.student_id, entry.group]));
        available = assessments(record.students);
        populateFilters(); render();
        $('#unlock-panel').hidden = true; $('#dashboard').hidden = false;
        setStatus(''); resetTimer(); $('#dashboard-heading').focus();
    } catch {
        if (attempt === generation) { lock(); setStatus('failure', true); }
    } finally {
        code = '';
        if (attempt === generation) { request = null; $('#unlock-button').disabled = !canDecrypt; }
    }
});
$('#lock-button').addEventListener('click', () => lock(true));
$('#language-toggle').addEventListener('click', () => { language = language === 'en' ? 'zh' : 'en'; translate(); });
$('#group-filter').addEventListener('change', render);
$('#assessment-filter').addEventListener('change', render);
$('#student-search').addEventListener('input', () => { if (record) renderTable(); });
$('#np-only').addEventListener('change', () => { if (record) renderTable(); });
for (const event of ['pointerdown', 'keydown', 'scroll', 'input', 'change']) document.addEventListener(event, resetTimer, {passive: true});
document.addEventListener('visibilitychange', () => { if (document.hidden) lock(); });
window.addEventListener('pagehide', () => lock());
window.addEventListener('pageshow', event => { if (event.persisted) lock(); });
translate();
$('#unlock-button').disabled = !canDecrypt;
if (!canDecrypt) setStatus('unavailable', true);
