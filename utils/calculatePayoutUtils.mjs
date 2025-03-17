function calculatePayout(bettingAmount, numberOfPlayers, profitPercentage) {
    const totalBet = bettingAmount * numberOfPlayers;
    const profit = totalBet * (profitPercentage / 100);
    return totalBet - profit;
  }

  export {calculatePayout};