export const learningGoals = [
  { id: 'pass', label: '及格就好', description: '掌握核心概念和典型题，优先打好基础。' },
  { id: 'expand', label: '多学一点', description: '系统理解原理，学习常见变化与知识应用。' },
  { id: 'mastery', label: '大师之境', description: '深入推导与综合应用，探索高阶问题。' },
] as const;

export const defaultLearningGoal = '多学一点';

export function learningGoalDescription(value: string) {
  return learningGoals.find(goal => goal.label === value)?.description ?? '';
}
