
function checkWinningCard(cardNumbers, calledNumbers, winningPattern) {
    console.log(`Checking winning pattern: ${winningPattern}`);
    console.log('Card numbers:', JSON.stringify(cardNumbers, null, 2));
    console.log('Called numbers:', calledNumbers);
    switch (winningPattern) {
      case 'All':
        return checkAllPatterns(cardNumbers, calledNumbers);
      case 'FullHouse':
        return checkFullHouse(cardNumbers, calledNumbers) ? ['FullHouse'] : false;
      case 'LShape':
        return checkLShape(cardNumbers, calledNumbers) ? ['LShape'] : false;
      case 'BothDiagonal':
        return checkBothDiagonals(cardNumbers, calledNumbers)
          ? ['BothDiagonal']
          : false;
      case 'OneDiagonal':
        const result = checkOneDiagonal(cardNumbers, calledNumbers);
        return result.isWinner
          ? { pattern: 'OneDiagonal', diagonal: result.diagonal }
          : false;
  
      case 'OneColumn':
        return checkOneColumn(cardNumbers, calledNumbers) ? ['OneColumn'] : false;
      case 'OneRow':
        return checkOneRow(cardNumbers, calledNumbers) ? ['OneRow'] : false;
      case 'Corner':
        return checkCorners(cardNumbers, calledNumbers) ? ['Corner'] : false;
      default:
        console.warn(`Unknown winning pattern: ${winningPattern}`);
        return false;
    }
  }
  
  function isCalled(num, letter, calledNumbers) {
    return calledNumbers.includes(`${letter}${num}`) || num === 'FREE';
  }
  
  function checkAllPatterns(cardNumbers, calledNumbers) {
    console.log('Checking all patterns');
    const patterns = [];
    // Check OneColumn
    const oneColumnResult = checkOneColumn(cardNumbers, calledNumbers);
    console.log('OneColumn result:', oneColumnResult);
    if (oneColumnResult) patterns.push('OneColumn');
  
    // Check OneRow
    const oneRowResult = checkOneRow(cardNumbers, calledNumbers);
    console.log('OneRow result:', oneRowResult);
    if (oneRowResult) patterns.push('OneRow');
  
    // Check OneDiagonal
    const diagonalResult = checkOneDiagonal(cardNumbers, calledNumbers);
    console.log('OneDiagonal result:', diagonalResult);
    if (diagonalResult.isWinner) patterns.push('OneDiagonal');
  
    // Check Corners
    const cornersResult = checkCorners(cardNumbers, calledNumbers);
    console.log('Corners result:', cornersResult);
    if (cornersResult) patterns.push('Corner');
  
    // Check SurroundingCenter
    const surroundingCenterResult = checkSurroundingCenter(
      cardNumbers,
      calledNumbers
    );
    console.log('SurroundingCenter result:', surroundingCenterResult);
    if (surroundingCenterResult) patterns.push('SurroundingCenter');
  
    // Check FullHouse
    const fullHouseResult = checkFullHouse(cardNumbers, calledNumbers);
    console.log('FullHouse result:', fullHouseResult);
    if (fullHouseResult) patterns.push('FullHouse');
  
    // Check LShape
    const lShapeResult = checkLShape(cardNumbers, calledNumbers);
    console.log('LShape result:', lShapeResult);
    if (lShapeResult) patterns.push('LShape');
  
    // Check BothDiagonals
    const bothDiagonalsResult = checkBothDiagonals(cardNumbers, calledNumbers);
    console.log('BothDiagonals result:', bothDiagonalsResult);
    if (bothDiagonalsResult) patterns.push('BothDiagonal');
  
    console.log('All patterns result:', patterns);
    return patterns;
  }
  
  function checkFullHouse(cardNumbers, calledNumbers) {
    console.log('Checking full house');
    return ['B', 'I', 'N', 'G', 'O'].every((column) =>
      cardNumbers[column].every((num) => isCalled(num, column, calledNumbers))
    );
  }
  
  function checkLShape(cardNumbers, calledNumbers) {
    const firstColumn = cardNumbers['B'].every((num) =>
      isCalled(num, 'B', calledNumbers)
    );
    const lastRow = ['B', 'I', 'N', 'G', 'O'].every((column) =>
      isCalled(cardNumbers[column][4], column, calledNumbers)
    );
    console.log(`First column: ${firstColumn}, Last row: ${lastRow}`);
    return firstColumn && lastRow;
  }
  
  function checkBothDiagonals(cardNumbers, calledNumbers) {
    const firstDiag = ['B0', 'I1', 'N2', 'G3', 'O4'].every((cell) => {
      const isCalled =
        calledNumbers.includes(
          `${cell[0]}${cardNumbers[cell[0]][parseInt(cell[1])]}`
        ) || cardNumbers[cell[0]][parseInt(cell[1])] === 'FREE';
      console.log(`Checking first diagonal cell ${cell}: ${isCalled}`);
      return isCalled;
    });
    const secondDiag = ['O0', 'G1', 'N2', 'I3', 'B4'].every((cell) => {
      const isCalled =
        calledNumbers.includes(
          `${cell[0]}${cardNumbers[cell[0]][parseInt(cell[1])]}`
        ) || cardNumbers[cell[0]][parseInt(cell[1])] === 'FREE';
      console.log(`Checking second diagonal cell ${cell}: ${isCalled}`);
      return isCalled;
    });
    console.log(
      `First diagonal complete: ${firstDiag}, Second diagonal complete: ${secondDiag}`
    );
    return firstDiag && secondDiag;
  }
  
  function checkCorners(cardNumbers, calledNumbers) {
    return ['B0', 'B4', 'O0', 'O4'].every((cell) =>
      isCalled(cardNumbers[cell[0]][parseInt(cell[1])], cell[0], calledNumbers)
    );
  }
  
  function checkSurroundingCenter(cardNumbers, calledNumbers) {
    return ['I1', 'I3', 'G1', 'G3'].every((cell) =>
      isCalled(cardNumbers[cell[0]][parseInt(cell[1])], cell[0], calledNumbers)
    );
  }
  
  function checkOneDiagonal(cardNumbers, calledNumbers) {
    const firstDiag = ['B0', 'I1', 'N2', 'G3', 'O4'].every((cell) =>
      isCalled(cardNumbers[cell[0]][parseInt(cell[1])], cell[0], calledNumbers)
    );
    const secondDiag = ['O0', 'G1', 'N2', 'I3', 'B4'].every((cell) =>
      isCalled(cardNumbers[cell[0]][parseInt(cell[1])], cell[0], calledNumbers)
    );
    console.log(
      `First diagonal complete: ${firstDiag}, Second diagonal complete: ${secondDiag}`
    );
    if (firstDiag) {
      return { isWinner: true, diagonal: 'first' };
    } else if (secondDiag) {
      return { isWinner: true, diagonal: 'second' };
    }
    return { isWinner: false, diagonal: null };
  }
  
  function checkOneColumn(cardNumbers, calledNumbers) {
    const result = ['B', 'I', 'N', 'G', 'O'].some((column) =>
      cardNumbers[column].every((num) => isCalled(num, column, calledNumbers))
    );
    console.log(`One column complete: ${result}`);
    return result;
  }
  
  function checkOneRow(cardNumbers, calledNumbers) {
    for (let i = 0; i < 5; i++) {
      if (
        ['B', 'I', 'N', 'G', 'O'].every((column) =>
          isCalled(cardNumbers[column][i], column, calledNumbers)
        )
      ) {
        console.log(`Row ${i + 1} complete`);
        return true;
      }
    }
    console.log('No complete rows');
    return false;
  }

  export {checkWinningCard,checkOneDiagonal};