
// Updated generateCalledNumbers function
let lastLuckyCardNumber = null;
function generateCalledNumbers(cardPaletteNumbers, bingoCards, shuffle) {
  // 1. Randomly select one lucky card from cardPaletteNumbers
  let availableCards = cardPaletteNumbers;
  if (lastLuckyCardNumber !== null) {
    availableCards = cardPaletteNumbers.filter(
      (num) => num !== lastLuckyCardNumber
    );
  }

  const luckyCardIndex = Math.floor(Math.random() * availableCards.length);
  const luckyCardNumber = availableCards[luckyCardIndex];
  const luckyCard = bingoCards.find(
    (card) => card.paletteNumber === luckyCardNumber
  );
  // Store this lucky card number for next game
  lastLuckyCardNumber = luckyCardNumber;

  console.log("Lucky Card:", luckyCard);

  // 2. Get all 25 numbers from lucky card (excluding FREE space)
  const luckyCardNumbers = [];
  Object.values(luckyCard.numbers).forEach((column) => {
    column.forEach((number) => {
      if (number !== "FREE") {
        luckyCardNumbers.push(number);
      }
    });
  });

  // 3. Randomly select 15 numbers from lucky card
  const priorityNumbers = [];
  while (priorityNumbers.length < 15) {
    const randomIndex = Math.floor(Math.random() * luckyCardNumbers.length);
    const number = luckyCardNumbers[randomIndex];
    if (!priorityNumbers.includes(number)) {
      priorityNumbers.push(number);
    }
  }

  // 4. Create array for first 20 calls with priority numbers randomly distributed
  const first20Calls = Array(20).fill(null);
  const availablePositions = Array.from({ length: 20 }, (_, i) => i);

  // Place 15 priority numbers randomly in first 20 positions
  priorityNumbers.forEach((number) => {
    const randomPosition = Math.floor(
      Math.random() * availablePositions.length
    );
    const position = availablePositions[randomPosition];
    availablePositions.splice(randomPosition, 1);

    // Add bingo letter prefix
    let letter;
    if (number <= 15) letter = "B";
    else if (number <= 30) letter = "I";
    else if (number <= 45) letter = "N";
    else if (number <= 60) letter = "G";
    else letter = "O";

    first20Calls[position] = `${letter}${number}`;
  });

  // 5. Get all remaining numbers from all cards
  const remainingNumbers = new Set();
  cardPaletteNumbers.forEach((paletteNumber) => {
    const card = bingoCards.find(
      (card) => card.paletteNumber === paletteNumber
    );
    Object.values(card.numbers).forEach((column) => {
      column.forEach((number) => {
        if (number !== "FREE" && !priorityNumbers.includes(number)) {
          remainingNumbers.add(number);
        }
      });
    });
  });

  // 6. Fill remaining positions in first 20 calls
  availablePositions.forEach((position) => {
    const remainingArray = Array.from(remainingNumbers);
    const randomIndex = Math.floor(Math.random() * remainingArray.length);
    const number = remainingArray[randomIndex];

    let letter;
    if (number <= 15) letter = "B";
    else if (number <= 30) letter = "I";
    else if (number <= 45) letter = "N";
    else if (number <= 60) letter = "G";
    else letter = "O";

    first20Calls[position] = `${letter}${number}`;
    remainingNumbers.delete(number);
  });

  // 7. Create final called numbers array
  const remainingCalls = Array.from(remainingNumbers).map((number) => {
    let letter;
    if (number <= 15) letter = "B";
    else if (number <= 30) letter = "I";
    else if (number <= 45) letter = "N";
    else if (number <= 60) letter = "G";
    else letter = "O";
    return `${letter}${number}`;
  });

  // Shuffle remaining calls if shuffle parameter is true
  if (shuffle) {
    for (let i = remainingCalls.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [remainingCalls[i], remainingCalls[j]] = [
        remainingCalls[j],
        remainingCalls[i],
      ];
    }
  }

  // Combine first 20 calls with remaining calls
  const finalCalledNumbers = [...first20Calls, ...remainingCalls];

  return finalCalledNumbers;
}
 export {generateCalledNumbers};