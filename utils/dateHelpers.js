function getFuzzyWeekTitle(weekStart) {
    const today = new Date();
    const currentWeekStart = new Date(today);
    currentWeekStart.setDate(today.getDate() - today.getDay() + 1); // Start from Monday
    
    // Reset hours to compare dates properly
    weekStart.setHours(0, 0, 0, 0);
    currentWeekStart.setHours(0, 0, 0, 0);
    
    const diffWeeks = Math.round((weekStart - currentWeekStart) / (7 * 24 * 60 * 60 * 1000));
    
    switch (diffWeeks) {
        case -1:
            return "Last Week";
        case 0:
            return "This Week";
        case 1:
            return "Next Week";
        default:
            // For other weeks, show the month and date of the week start
            return weekStart.toLocaleDateString('en-US', { 
                month: 'long',
                day: 'numeric'
            }) + ' Week';
    }
}

module.exports = {
    getFuzzyWeekTitle
}; 