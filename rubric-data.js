/************************************************************
 * RUBRIC DATA (shared by entry.html and report.html)
 *
 * DISPLAY ONLY. Skill names here are the stored data keys; never rename
 * them. Wording, groups and per-level text can change without touching
 * saved scores. Edit here once; the entry form and the report both read it.
 *
 *   VT_SKILL_GROUPS   the four sections (headings + which skills)
 *   VT_SKILL_RUBRICS  per skill: the designer's rubric row(s), one text
 *                     per level 0-4 (an array of rows when a skill covers
 *                     two rubric rows)
 *   VT_LEVELS         level numbers, names and one-line descriptions
 ************************************************************/
const VT_LEVELS = [
    { n: 0, name: "Incomplete",      desc: "Does not perform the skill or requires full assistance." },
    { n: 1, name: "Direct Support",  desc: "Requires directives, modeling, or frequent oversight." },
    { n: 2, name: "Minimal Support", desc: "Requires cues, reminders, or occasional oversight." },
    { n: 3, name: "Independent",     desc: "Performs the skill without support." },
    { n: 4, name: "Advanced",        desc: "Performs the skill beyond expectation." }
];

const VT_SKILL_GROUPS = [
    { title: "Work Habits", skills: [
        "Punctual", "Prepared with Necessary Materials", "Demonstrates appropriate hygiene/dress",
        "Initiates familiar tasks", "Maintains a productive work rate", "Complete tasks in a logical order",
        "Work is completed to quality standards"] },
    { title: "On the Job", skills: [
        "Demonstrates adaptability", "Maintains clean and organized work space",
        "Awareness of surroundings and good decision making", "Asks for help appropriately"] },
    { title: "Communication", skills: [
        "Appropriate and respectful social interactions", "Displays effective communication skills",
        "Accepts constructive criticism"] },
    { title: "Attitude & Growth", skills: [
        "Demonstrates a positive attitude", "Demonstrates self-reflection"] }
];

const VT_SKILL_RUBRICS = {
    "Punctual": { title: "Punctual", rows: [
        "Not on time even with directives, or modeling.",
        "On time with directives, or modeling.",
        "On time with cues or reminders.",
        "On time independently.",
        "Early independently."] },
    "Prepared with Necessary Materials": { title: "Prepared", rows: [
        "Does not collect required materials to perform the job task(s) even with directives, or modeling.",
        "Collects required materials to perform the job task(s) with directives, or modeling.",
        "Collects required materials to perform the job task(s) with cues or reminders.",
        "Collects required materials to perform the job task(s) independently.",
        "Collects required materials to perform the job task(s) independently and models preparedness to others."] },
    "Demonstrates appropriate hygiene/dress": { title: "Appearance", rows: [
        "Does not correct hygiene or dress errors even with directives, or modeling.",
        "Corrects hygiene or dress errors with directives, or modeling.",
        "Corrects hygiene or dress errors with cues or reminders.",
        "Demonstrates proper hygiene and appropriate dress independently.",
        "Demonstrates proper hygiene and dress independently and models hygiene/dress standards to others."] },
    "Initiates familiar tasks": { title: "Task Initiation", rows: [
        "Does not start familiar tasks promptly even with directives, or modeling.",
        "Initiates familiar tasks promptly with directives or modeling.",
        "Initiates familiar tasks promptly with cues or reminders.",
        "Initiates familiar tasks promptly independently.",
        "Initiates familiar tasks promptly independently and models initiative to others."] },
    "Complete tasks in a logical order": { title: "Logical Order", rows: [
        "Does not complete tasks in a logical order even with directives or modeling.",
        "Completes tasks in a logical order with directives or modeling.",
        "Completes tasks in a logical order with cues or reminders.",
        "Completes tasks in a logical order independently. Self-corrects when necessary.",
        "Completes tasks in a logical order independently without error."] },
    "Work is completed to quality standards": { title: "Quality Work", rows: [
        "Does not complete tasks thoroughly and accurately even with directives or modeling.",
        "Completes tasks thoroughly and accurately with directives or modeling.",
        "Completes tasks thoroughly and accurately with cues or reminders.",
        "Completes tasks thoroughly and accurately. Self-corrects when necessary.",
        "Completes tasks thoroughly and accurately independently with no errors."] },
    "Maintains a productive work rate": { title: "Work Rate", rows: [
        "Does not continuously work at a productive rate even with directives or modeling.",
        "Continuously works at a productive rate with directives or modeling.",
        "Continuously works at a productive rate with cues or reminders.",
        "Continuously works at a productive rate independently.",
        "Exceeds expected productivity."] },
    "Demonstrates adaptability": { title: "Adaptability", rows: [
        "Does not adapt to changes to assigned tasks, environment, or personnel even with directives or modeling.",
        "Adapts to changes to assigned tasks, environment, or personnel with directives or modeling.",
        "Adapts to changes to assigned tasks, environment, or personnel with cues or reminders.",
        "Adapts to changes to assigned tasks, environment, or personnel independently.",
        "Adapts to changes in assigned tasks, environment, or personnel independently and enthusiastically."] },
    "Maintains clean and organized work space": { title: "Organization", rows: [
        "Does not clean or organize workspace even with directives or modeling.",
        "Cleans and organizes workspace with directives or modeling.",
        "Relies on cues or reminders to clean and organize workspace.",
        "Cleans and organizes workspace.",
        "Cleans and organizes workspace beyond expectation."] },
    "Awareness of surroundings and good decision making": { title: "Safety", rows: [
        "Does not safely navigate the environment, use equipment, nor respond to novel situations even with directives or modeling.",
        "Safely navigates the environment, uses equipment, and responds to novel situations with directives or modeling.",
        "Safely navigates the environment, uses equipment, and responds to novel situations with cues or reminders.",
        "Safely navigates the environment, uses equipment, and responds to novel situations.",
        "Safely navigates the environment, uses equipment, and responds to novel situations. Demonstrates exceptional judgment."] },
    "Demonstrates a positive attitude": { title: "Attitude", rows: [
        "Does not maintain a positive attitude by completing tasks without complaint nor uses positive self-talk or other coping strategies to persevere even with directives, or modeling.",
        "Maintains a positive attitude by completing tasks without complaint and uses positive self-talk or other coping strategies to persevere with directives or modeling.",
        "Maintains a positive attitude by completing tasks without complaint and uses positive self-talk or other coping strategies to persevere with cues or reminders.",
        "Maintains a positive attitude by completing tasks without complaint and uses positive self-talk or other coping strategies to persevere.",
        "Maintains a positive attitude by completing tasks without complaint and uses positive self-talk or other coping strategies to persevere exceeding expectations."] },
    "Accepts constructive criticism": { title: "Constructive Feedback", rows: [
        "Does not respond positively to feedback or make adjustments to improve performance even with directives or modeling.",
        "Responds positively to feedback and makes adjustments to improve performance with directives or modeling.",
        "Responds positively to feedback and makes adjustments to improve performance with cues or reminders.",
        "Responds positively to feedback and makes adjustments to improve performance.",
        "Responds positively to feedback and makes adjustments to improve performance and actively seeks feedback."] },
    "Demonstrates self-reflection": { title: "Self-Reflection", rows: [
        "Does not identify strengths, weaknesses, nor generates suggestions for improvement even with directives or modeling.",
        "Identifies strengths, weaknesses, and generates suggestions for improvement with directives or modeling.",
        "Identifies strengths, weaknesses, and generates suggestions for improvement with cues or reminders.",
        "Identifies strengths, weaknesses, and generates suggestions for improvement independently.",
        "Identifies strengths, weaknesses, and generates suggestions for improvement independently. Reflection is comprehensive and insightful."] },
    "Asks for help appropriately": { title: "Resourcefulness", rows: [
        "Does not request additional tasks when assigned tasks are complete even with directives or modeling.",
        "Requests additional tasks when assigned tasks are complete with directives or modeling.",
        "Requests additional tasks when assigned tasks are complete with cues or reminders.",
        "Requests additional tasks when assigned tasks are complete.",
        "Requests additional tasks when assigned tasks are complete or identifies additional tasks independently."] },
    /* One skill, more than one rubric section (arrays) */
    "Appropriate and respectful social interactions": [
        { title: "Respect", rows: [
            "Does not demonstrate respectful social interactions or respect for personal space and property, even with directives or modeling.",
            "Demonstrates respectful social interactions and respect for personal space and property, with directives or modeling.",
            "Demonstrates respectful social interactions and respect for personal space and property with cues or reminders.",
            "Demonstrates respectful social interactions and respect for personal space and property independently.",
            "Demonstrates respectful social interactions and respect for personal space and property independently and additional care for the rights of others."] },
        { title: "Conversation Skills", rows: [
            "Does not engage in conversation or does not follow social norms even with directives or modeling.",
            "Engages in conversation following social norms (eye contact, active listening, appropriate topics, volume) with directives or modeling.",
            "Engages in conversation following social norms (eye contact, active listening, appropriate topics, volume) with cues or reminders.",
            "Engages in conversation following social norms (eye contact, active listening, appropriate topics, volume) independently.",
            "Engages in conversation following social norms (eye contact, active listening, appropriate topics, volume) independently and adjusts based on the partner's interests, responses, and cues."] }
    ],
    "Displays effective communication skills": [
        { title: "Expressive Communication", rows: [
            "Does not clearly express thoughts, respond to questions, or requests help, even with directives, or modeling.",
            "Clearly expresses thoughts, responds to questions, and requests help, with directives or modeling.",
            "Clearly expresses thoughts, responds to questions, and requests help with cues or reminders.",
            "Clearly expresses thoughts, responds to questions, and requests help independently.",
            "Clearly expresses thoughts, responds to questions, and requests help independently and with additional clarifying details or questions."] },
        { title: "Receptive Communication", rows: [
            "Does not follow directions (visual or verbal) even with, directives or modeling.",
            "Follows 2-3 step directions (visual or verbal) with directives or modeling.",
            "Follows 2-3 step directions (visual or verbal) with cues or reminders.",
            "Follows 2-3 step directions (visual or verbal) independently.",
            "Follows 4+ step directions (visual or verbal) independently."] }
    ]
};

/* The name people see for a behavioral skill: the designer's rubric row name(s)
   (Appearance, Task Initiation, Respect & Conversation Skills ...). Display only;
   scores are always read and saved under the stored skill name. */
function vtSkillTitle(name) {
    const r = VT_SKILL_RUBRICS[name];
    if (!r) return name;
    return (Array.isArray(r) ? r : [r]).map(row => row.title).join(" & ");
}
