// Helper function to calculate monthly trend
function calculateMonthlyTrend(analytics) {
    const monthlyData = {};
  
    analytics.forEach((transaction) => {
      const date = new Date(transaction.date);
      const monthYear = `${date.getMonth() + 1}/${date.getFullYear()}`;
  
      if (!monthlyData[monthYear]) {
        monthlyData[monthYear] = {
          month: monthYear,
          profit: 0,
          transactions: 0,
        };
      }
  
      monthlyData[monthYear].profit += transaction.profitGenerated;
      monthlyData[monthYear].transactions += 1;
    });
  
    // Convert to array and sort by date
    return Object.values(monthlyData)
      .sort((a, b) => {
        const [aMonth, aYear] = a.month.split('/');
        const [bMonth, bYear] = b.month.split('/');
        return new Date(aYear, aMonth - 1) - new Date(bYear, bMonth - 1);
      })
      .slice(-12); 
  }
  
  export {calculateMonthlyTrend};