// 初始化 Firebase
const app = firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// 初始化變量
let currentScore = 0;
let timer = null;
let timeLeft = 20;
let currentSessionId = null;
let playerName = '';
let gameStarted = false; // 新增遊戲狀態標記
let leaderboard = JSON.parse(localStorage.getItem('spaceQuizLeaderboard')) || [];
let gameSession = null;

async function startGame() {
    try {
        playerName = document.querySelector('input[type="text"]').value.trim();
        if (!playerName) {
            alert('請輸入名字！');
            return;
        }

        document.getElementById('waitingMessage').style.display = 'block';
        
        // 尋找可用的會話
        const availableSessionId = await findAvailableSession();
        
        if (availableSessionId) {
            // 加入現有會話
            currentSessionId = availableSessionId;
            await database.ref(`gameSessions/${currentSessionId}`).update({
                player2: playerName,
                status: 'ready'
            });
        } else {
            // 創建新會話的數據
            const sessionData = {
                player1: playerName,
                status: 'waiting',
                timestamp: Date.now(),
                scores: {
                    [playerName]: {
                        score: 0,
                        timestamp: Date.now()
                    }
                }
            };

            // 創建新會話
            const newSessionRef = await database.ref('gameSessions').push(sessionData);
            currentSessionId = newSessionRef.key;
            
            // 更新 session id
            await database.ref(`gameSessions/${currentSessionId}`).update({
                id: currentSessionId
            });
        }

        // 監聽會話狀態
        database.ref(`gameSessions/${currentSessionId}`).on('value', (snapshot) => {
            const session = snapshot.val();
            if (session && session.status === 'ready' && !gameStarted) {
                gameStarted = true;
                document.getElementById('waitingMessage').style.display = 'none';
                document.querySelector('.input-container').style.display = 'none';
                document.querySelector('.game-container').style.display = 'block';
                
                if (!document.querySelector('.player-info').textContent) {
                    document.querySelector('.player-info').textContent = `參加者：${playerName}`;
                }
                
                if (!timer) {
                    startTimer();
                }
                updateScore();
                initializeScanner();
            }
        });
    } catch (error) {
        console.error('Error:', error);
        alert('發生錯誤：' + error.message);
    }
}

function addScore(isCorrect) {
    if (isCorrect) {
        currentScore++;
        document.getElementById('currentScore').textContent = currentScore;
    }
}

function formatDateTime(timestamp) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}/${month}/${day} ${hours}:${minutes}`;
}

// 計時器函數
function startTimer() {
    if (timer) {
        clearInterval(timer);
    }
    
    timeLeft = 20; // 設置倒計時
    updateTimerDisplay();
    
    timer = setInterval(() => {
        timeLeft--;
        updateTimerDisplay();
        
        if (timeLeft <= 0) {
            clearInterval(timer);
            timer = null;
            // 檢查問題容器狀態
            checkIfGameShouldEnd();
        }
    }, 1000);
}

function updateTimerDisplay() {
    document.querySelector('.timer span').textContent = timeLeft;
}

// 檢查是否應該結束遊戲
function checkIfGameShouldEnd() {
    const questionContainer = document.querySelector('.question-container');
    if (!questionContainer) {
        console.error('找不到問題容器');
        return;
    }

    // 只有當問題容器是隱藏的時候才結束遊戲
    if (questionContainer.style.display === 'none') {
        endGame();
    } else {
        console.log('等待當前問題完成...');
        // 設置監聽器等待問題容器隱藏
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && 
                    mutation.attributeName === 'style' &&
                    questionContainer.style.display === 'none') {
                    observer.disconnect();
                    endGame();
                }
            });
        });

        observer.observe(questionContainer, {
            attributes: true,
            attributeFilter: ['style']
        });
    }
}

// 結束遊戲並顯示結果
function endGame() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }

    if (currentSessionId && playerName) {
        // 先標記自己完成
        database.ref(`gameSessions/${currentSessionId}/scores/${playerName}`).update({
            score: currentScore,
            finalScore: currentScore,
            completed: true,
            timestamp: Date.now()
        }).then(() => {
            // 等待雙方都完成
            waitForBothPlayersToComplete();
        }).catch(error => {
            console.error('保存分數時出錯：', error);
        });
    }
}

// 修改 waitForBothPlayersToComplete 函數
function waitForBothPlayersToComplete() {
    database.ref(`gameSessions/${currentSessionId}/scores`).on('value', (snapshot) => {
        const scores = snapshot.val();
        if (!scores) return;

        const players = Object.entries(scores);
        const allCompleted = players.length === 2 && 
                           players.every(([_, data]) => data.completed);

        if (allCompleted) {
            // 停止監聽
            database.ref(`gameSessions/${currentSessionId}/scores`).off();
            
            // 隱藏等待訊息
            document.getElementById('waitingMessage').style.display = 'none';
            
            // 顯示最終結果
            document.querySelector('.game-container').style.display = 'none';
            document.getElementById('resultContainer').style.display = 'block';
            document.getElementById('finalScore').textContent = currentScore;
            checkOpponentScore();
        } else {
            // 顯示等待訊息
            document.querySelector('.game-container').style.display = 'none';
            document.getElementById('waitingMessage').textContent = '等待對手完成...';
            document.getElementById('waitingMessage').style.display = 'block';
        }
    });
}

// 檢查對手分數並顯示結果
function checkOpponentScore() {
    if (!currentSessionId || !playerName) return;

    database.ref(`gameSessions/${currentSessionId}/scores`).once('value', (snapshot) => {
        const scores = snapshot.val();
        if (scores) {
            const players = Object.keys(scores);
            const opponent = players.find(p => p !== playerName);
            
            if (opponent) {
                const opponentData = scores[opponent];
                const opponentScore = opponentData.finalScore || opponentData.currentScore || 0;
                document.getElementById('opponentScore').textContent = opponentScore;
                
                // 顯示勝負
                const resultMessage = document.getElementById('resultMessage');
                resultMessage.className = ''; // 清除現有的類

                if (currentScore > opponentScore) {
                    resultMessage.textContent = '🏆 恭喜你獲勝！';
                    resultMessage.classList.add('win');
                } else if (currentScore < opponentScore) {
                    resultMessage.textContent = '💔 很遺憾，你輸了！';
                    resultMessage.classList.add('lose');
                } else {
                    resultMessage.textContent = '🤝 平局！';
                    resultMessage.classList.add('draw');
                }
            }
        }
    });
}

// 計分函數
function handleCorrect() {
    if (!timer) return; // 如果計時器不存在，不計分
    currentScore += 10;
    updateScore();
    playScoreAnimation(true);
}

function handleWrong() {
    if (!timer) return; // 如果計時器不存在，不計分
    currentScore = Math.max(0, currentScore - 5);
    updateScore();
    playScoreAnimation(false);
}

function updateScore() {
    // 更新顯示的分數
    const scoreElement = document.querySelector('.score');
    if (scoreElement) {
        scoreElement.textContent = `目前分數：${currentScore}`;
    }
    
    // 更新 Firebase 中的即時分數
    if (currentSessionId && playerName) {
        database.ref(`gameSessions/${currentSessionId}/scores/${playerName}`).update({
            currentScore: currentScore
        });
    }
}

// 添加分數動畫效果
function playScoreAnimation(isCorrect) {
    const animation = document.createElement('div');
    animation.className = `score-animation ${isCorrect ? 'correct' : 'wrong'}`;
    animation.textContent = isCorrect ? '+10' : '-5';
    document.querySelector('.game-container').appendChild(animation);
    
    setTimeout(() => animation.remove(), 1000);
}

// 顯示指定頁面的函數
function showPage(pageNumber) {
    // 隱藏所有頁面
    const pages = document.getElementsByClassName('page');
    for (let i = 0; i < pages.length; i++) {
        pages[i].style.display = 'none';
    }
    
    // 顯示指定的頁面
    const targetPage = document.getElementById('page' + pageNumber);
    if (targetPage) {
        targetPage.style.display = 'block';
    }
}

// 顯示排行榜
function showLeaderboard(fromResultPage = false) {
    console.log('showLeaderboard called with fromResultPage:', fromResultPage);
    console.log('currentSessionId:', currentSessionId);
    console.log('playerName:', playerName);

    const leaderboardList = document.getElementById('leaderboardList');
    const currentPlayerRankDiv = document.getElementById('currentPlayerRank');
    
    if (!currentPlayerRankDiv) {
        console.error('currentPlayerRankDiv not found');
        return;
    }

    leaderboardList.innerHTML = '';
    currentPlayerRankDiv.innerHTML = '';
    
    // 隱藏其他容器
    document.querySelector('.input-container').style.display = 'none';
    document.querySelector('.game-container').style.display = 'none';
    document.getElementById('resultContainer').style.display = 'none';
    
    // 顯示排行榜容器
    document.getElementById('leaderboardContainer').style.display = 'block';
    
    // 從 Firebase 獲取排行榜數據
    database.ref('gameSessions').once('value', (snapshot) => {
        const sessions = snapshot.val();
        const scores = [];
        
        console.log('Retrieved sessions:', sessions);
        
        if (sessions) {
            Object.values(sessions).forEach(session => {
                if (session.scores) {
                    Object.entries(session.scores).forEach(([name, data]) => {
                        if (data.finalScore !== undefined) {
                            const isCurrentGame = fromResultPage && 
                                               name === playerName && 
                                               session.id === currentSessionId;
                            
                            console.log('Score entry:', {
                                name,
                                score: data.finalScore,
                                sessionId: session.id,
                                isCurrentGame
                            });

                            scores.push({
                                name: name,
                                score: data.finalScore,
                                timestamp: data.timestamp || Date.now(),
                                isCurrentPlayer: isCurrentGame
                            });
                        }
                    });
                }
            });
        }
        
        // 排序分數
        scores.sort((a, b) => {
            if (b.score !== a.score) {
                return b.score - a.score;
            }
            return a.timestamp - b.timestamp;
        });

        // 找到當前玩家的排名
        const currentPlayerIndex = scores.findIndex(score => score.isCurrentPlayer);
        console.log('Current player index:', currentPlayerIndex);
        
        if (fromResultPage && currentPlayerIndex !== -1) {
            const currentPlayerRank = currentPlayerIndex + 1;
            const currentPlayer = scores[currentPlayerIndex];
            
            console.log('Displaying current player rank:', {
                rank: currentPlayerRank,
                player: currentPlayer
            });

            currentPlayerRankDiv.innerHTML = `
                你的排名：第 ${currentPlayerRank} 名
                <br>
                分數：${currentPlayer.score}
                <br>
                時間：${formatDateTime(currentPlayer.timestamp)}
            `;
            currentPlayerRankDiv.style.display = 'block';
        } else {
            console.log('Current player rank not shown because:', {
                fromResultPage,
                currentPlayerIndex
            });
            currentPlayerRankDiv.style.display = 'none';
        }
        
        // 顯示前10名
        scores.slice(0, 10).forEach((score, index) => {
            const scoreElement = document.createElement('div');
            scoreElement.className = 'leaderboard-item';
            
            if (index < 3) {
                scoreElement.classList.add('top-3', `rank-${index + 1}`);
            }
            
            scoreElement.innerHTML = `
                <span class="rank">${index + 1}</span>
                <span class="name">${score.name}</span>
                <span class="score">${score.score}</span>
                <span class="time">${formatDateTime(score.timestamp)}</span>
            `;
            leaderboardList.appendChild(scoreElement);
        });
    });
}

// 重新開始遊戲
function restartGame() {
    // 清理遊戲狀態
    cleanupGame();
    
    // 返回到輸入名字的界面
    document.getElementById('leaderboardContainer').style.display = 'none';
    document.querySelector('.input-container').style.display = 'block';
    
    // 清空輸入框
    const nameInput = document.querySelector('input[type="text"]');
    if (nameInput) {
        nameInput.value = '';
    }
}

// 保存排行榜到本地存儲
function saveLeaderboard() {
    localStorage.setItem('spaceQuizLeaderboard', JSON.stringify(leaderboard));
}

function goBack(currentPage) {
    document.getElementById(`page${currentPage}`).style.display = 'none';
    document.getElementById(`page${currentPage-1}`).style.display = 'block';
    
    if (currentPage === 2) {
        // 返回到第一頁時重置分數
        currentScore = 0;
        document.getElementById('currentScore').textContent = '0';
    }
}

// 更新排行榜相關函數
function updateLeaderboard(playerName, score) {
    const leaderboardRef = database.ref('leaderboard');
    const newScore = {
        name: playerName,
        score: score,
        timestamp: Date.now()
    };
    leaderboardRef.push(newScore);
}

// 測試 Firebase 連接
function testFirebaseConnection() {
    console.log('開始測試 Firebase 連接...');
    
    const testRef = database.ref('test');
    console.log('數據庫參考創建成功');
    
    testRef.set({
        timestamp: Date.now(),
        message: '測試連接'
    })
    .then(() => {
        console.log('Firebase 連接成功！');
    })
    .catch((error) => {
        console.error('Firebase 連接錯誤：', error);
    });
}

// 在頁面加載完成後執行測試
document.addEventListener('DOMContentLoaded', () => {
    console.log('頁面加載完成，準備測試 Firebase...');
    testFirebaseConnection();
});

// 尋找可用會話的輔助函數
async function findAvailableSession() {
    const snapshot = await database.ref('gameSessions')
        .orderByChild('status')
        .equalTo('waiting')
        .once('value');
    
    const sessions = snapshot.val();
    return sessions ? Object.keys(sessions)[0] : null;
}

// 初始化事件監聽
document.addEventListener('DOMContentLoaded', () => {
    const startButton = document.querySelector('.input-container button');
    
    // 移除之前的事件監聽器
    startButton.removeEventListener('click', startGame);
    // 添加新的事件監聽器
    startButton.addEventListener('click', startGame);
    
    // 移除之前的按鈕事件監聽器
    const correctButton = document.querySelector('.correct-btn');
    const wrongButton = document.querySelector('.wrong-btn');
    const completeButton = document.querySelector('.complete-btn');
    
    if (correctButton) {
        correctButton.removeEventListener('click', handleCorrect);
        correctButton.addEventListener('click', handleCorrect);
    }
    if (wrongButton) {
        wrongButton.removeEventListener('click', handleWrong);
        wrongButton.addEventListener('click', handleWrong);
    }
    if (completeButton) {
        completeButton.removeEventListener('click', endGame);
        completeButton.addEventListener('click', endGame);
    }
    
    // 主頁面的排行榜按鈕
    const mainLeaderboardBtn = document.querySelector('.input-container .leaderboard-btn');
    if (mainLeaderboardBtn) {
        mainLeaderboardBtn.onclick = () => showLeaderboard();
    }
    
    // 結果頁面的排行榜按鈕
    const resultLeaderboardBtn = document.querySelector('.result-container .leaderboard-btn');
    if (resultLeaderboardBtn) {
        resultLeaderboardBtn.onclick = () => showLeaderboard(true);
    }
    
    // 返回按鈕
    const backButton = document.querySelector('.back-btn');
    if (backButton) {
        backButton.onclick = backFromLeaderboard;
    }
    
    // 再次挑戰按鈕
    const restartButton = document.querySelector('.restart-btn');
    if (restartButton) {
        restartButton.onclick = restartGame;
    }
});

// 初始化掃描器
function initializeScanner() {
    try {
        // 創建掃描器實例，使用更多的配置選項
        html5QrcodeScanner = new Html5QrcodeScanner(
            "qr-reader", 
            { 
                fps: 10,
                qrbox: 250,
                aspectRatio: 1.0,
                showTorchButtonIfSupported: true,
                rememberLastUsedCamera: true, // 記住上次使用的攝像頭
                defaultInputByImplementation: { // 設置默認使用後置攝像頭
                    preferredFacingMode: 'environment'
                },
                formatsToSupport: [ Html5QrcodeSupportedFormats.QR_CODE ], // 只掃描 QR Code
                useBarCodeDetectorIfSupported: true, // 使用原生 API 以提高性能
                showZoomSliderIfSupported: true, // 顯示縮放控制
                // 自定義 UI
                config: {
                    fps: { hidden: true }, // 隱藏 FPS 選擇
                    qrbox: { hidden: true }, // 隱藏掃描框大小選擇
                    aspectRatio: { hidden: true }, // 隱藏寬高比選擇
                    videoConstraints: { hidden: true } // 隱藏攝像頭選擇
                }
            }
        );

        // 處理掃描成功
        const onScanSuccess = (decodedText, decodedResult) => {
            console.log('掃描到的內容：', decodedText); // 用於調試
            
            // 檢查是否是 Q1, Q2, Q3 格式
            if (decodedText && decodedText.match(/^Q[1-3]$/)) {
                const questionId = decodedText; // 直接使用 Q1, Q2, Q3 作為索引
                
                // 從 quizQuestions 獲取對應的題目
                const question = quizQuestions[questionId];
                if (question) {
                    // 顯示題目
                    showQuestion(question);
                    // 暫停掃描器
                    html5QrcodeScanner.pause();
                } else {
                    showMessage('無效的題目代碼', 'error');
                }
            } else {
                showMessage('無效的 QR Code', 'error');
            }
        };

        // 處理掃描失敗
        const onScanFailure = (error) => {
            // 忽略掃描失敗
        };

        // 啟動掃描器
        html5QrcodeScanner.render(onScanSuccess, onScanFailure);
        
    } catch (error) {
        showDebug('初始化掃描器錯誤: ' + error.message, true);
    }
}

// 顯示題目
function showQuestion(question) {
    console.log('開始顯示題目:', question);
    
    const questionContainer = document.querySelector('.question-container');
    const questionText = document.getElementById('questionText');
    const options = document.querySelectorAll('.option-btn');
    const qrReader = document.getElementById('qr-reader');
    
    if (!questionContainer || !questionText || !options.length) {
        console.error('找不到必要的 DOM 元素');
        return;
    }
    
    // 隱藏掃描器
    qrReader.style.display = 'none';
    
    questionText.textContent = question.question;
    
    // 重置所有按鈕的樣式
    options.forEach(button => {
        button.className = 'option-btn';
    });
    
    // 設置選項
    options.forEach((button, index) => {
        const optionKey = String.fromCharCode(65 + index); // A, B, C
        const optionText = question.options[optionKey];
        button.textContent = `${optionKey}. ${optionText}`;
        button.dataset.option = optionKey;
        button.onclick = () => handleAnswer(button, optionKey, question.correctAnswer);
    });
    
    questionContainer.style.display = 'block';
}

// 處理答案
function handleAnswer(selectedButton, selectedOption, correctAnswer) {
    const questionContainer = document.querySelector('.question-container');
    const options = document.querySelectorAll('.option-btn');
    const qrReader = document.getElementById('qr-reader');
    
    // 禁用所有按鈕，防止重複點擊
    options.forEach(button => button.disabled = true);
    
    // 顯示答案結果並更新分數
    if (selectedOption === correctAnswer) {
        selectedButton.classList.add('correct');
        currentScore += 10;
        updateScore();
        showMessage('答對了！+10分', 'success');
    } else {
        selectedButton.classList.add('wrong');
        options.forEach(button => {
            if (button.dataset.option === correctAnswer) {
                button.classList.add('correct');
            }
        });
        showMessage('答錯了！', 'error');
    }
    
    // 3秒後重置界面
    setTimeout(() => {
        // 隱藏題目
        questionContainer.style.display = 'none';
        
        // 重置按鈕樣式和狀態
        options.forEach(button => {
            button.className = 'option-btn';
            button.disabled = false;
        });
        
        // 顯示掃描器
        qrReader.style.display = 'block';
        
        // 恢復掃描器
        if (html5QrcodeScanner) {
            html5QrcodeScanner.resume();
        }

        // 如果計時器已經結束，檢查是否應該結束遊戲
        if (!timer) {
            checkIfGameShouldEnd();
        }
    }, 3000);
}

// 顯示訊息
function showMessage(message, type = 'info') {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.textContent = message;
    document.querySelector('.game-container').appendChild(messageDiv);
    
    // 2秒後自動移除訊息
    setTimeout(() => {
        messageDiv.remove();
    }, 2000);
}

// 播放成功音效
function playSuccessSound() {
    const audio = new Audio('success.mp3'); // 需要添加音效文件
    audio.play().catch(() => {
        // 忽略播放失敗的錯誤
    });
}

// 在遊戲結束時清理掃描器
function cleanupScanner() {
    if (html5QrcodeScanner) {
        html5QrcodeScanner.clear().catch(error => {
            showDebug('清理掃描器錯誤: ' + error.message, true);
        });
        html5QrcodeScanner = null;
    }
}

// 更新時間顯示
function updateCurrentTime() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const timeString = `${hours}:${minutes}`;
    
    const timeElement = document.getElementById('currentTime');
    if (timeElement) {
        timeElement.textContent = timeString;
    }
}

// 頁面加載時立即更新時間
document.addEventListener('DOMContentLoaded', () => {
    updateCurrentTime();
    // 每分鐘更新一次
    setInterval(updateCurrentTime, 60000);
});

// 清理遊戲狀態
function cleanupGame() {
    try {
        // 1. 清理界面元素
        const questionContainer = document.querySelector('.question-container');
        if (questionContainer) {
            questionContainer.style.display = 'none';
            const questionText = document.getElementById('questionText');
            if (questionText) {
                questionText.textContent = '';
            }
        }

        // 重置所有按鈕
        const options = document.querySelectorAll('.option-btn');
        options.forEach(button => {
            button.className = 'option-btn';
            button.disabled = false;
            button.textContent = '';
        });

        // 清理掃描器
        if (html5QrcodeScanner) {
            html5QrcodeScanner.clear().catch(() => {
                console.log('掃描器已被清理');
            });
            html5QrcodeScanner = null;
        }

        // 2. 移除 Firebase 監聽器
        if (currentSessionId) {
            database.ref(`gameSessions/${currentSessionId}`).off();
        }

        // 3. 重置遊戲狀態
        currentSessionId = null;
        playerName = '';
        currentScore = 0;
        timeLeft = 20;
        gameStarted = false;
        
        if (timer) {
            clearInterval(timer);
            timer = null;
        }

        // 4. 重置顯示
        document.querySelector('.game-container').style.display = 'none';
        document.querySelector('.input-container').style.display = 'block';
        document.getElementById('resultContainer').style.display = 'none';
        document.getElementById('leaderboardContainer').style.display = 'none';
        document.getElementById('waitingMessage').style.display = 'none';
        document.querySelector('.player-info').textContent = '';
        document.querySelector('.score').textContent = '目前分數：0';

        // 5. 清空輸入框
        const nameInput = document.querySelector('input[type="text"]');
        if (nameInput) {
            nameInput.value = '';
        }

        console.log('遊戲狀態已完全清理');
    } catch (error) {
        console.error('清理遊戲狀態時發生錯誤:', error);
    }
}
