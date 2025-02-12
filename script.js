// 添加調試功能
function showDebug(message, isError = false) {
    const debugArea = document.getElementById('debugArea');
    const debugContent = document.getElementById('debugContent');
    debugArea.style.display = 'block';
    
    const time = new Date().toLocaleTimeString();
    const msgDiv = document.createElement('div');
    msgDiv.style.color = isError ? '#ff4444' : '#ffffff';
    msgDiv.textContent = `[${time}] ${message}`;
    
    debugContent.appendChild(msgDiv);
    debugContent.scrollTop = debugContent.scrollHeight;
}

function clearDebug() {
    const debugContent = document.getElementById('debugContent');
    debugContent.innerHTML = '';
    document.getElementById('debugArea').style.display = 'none';
}

// 捕獲全局錯誤
window.onerror = function(msg, url, line, col, error) {
    showDebug(`ERROR: ${msg} (${line}:${col})`, true);
    return false;
};

// 重寫 console.log 和 console.error
const originalLog = console.log;
const originalError = console.error;

console.log = function() {
    const args = Array.from(arguments);
    showDebug(args.join(' '));
    originalLog.apply(console, arguments);
};

console.error = function() {
    const args = Array.from(arguments);
    showDebug(args.join(' '), true);
    originalError.apply(console, arguments);
};

// 初始化 Firebase
const app = firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// 確保這些變量在文件最開始定義
let currentScore = 0;
let timer = null;
let timeLeft = 60;
let currentSessionId = null;
let playerName = '';
let gameStarted = false;
let html5QrcodeScanner = null;

// 清理遊戲狀態
window.cleanupGame = function() {
    showDebug('執行清理遊戲狀態');
    try {
        if (currentSessionId) {
            database.ref(`gameSessions/${currentSessionId}`).off();
        }
        
        if (html5QrcodeScanner) {
            html5QrcodeScanner.stop().catch(err => {
                showDebug('停止掃描器錯誤: ' + err.message, true);
            });
            html5QrcodeScanner = null;
        }
        
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
        
        currentScore = 0;
        timeLeft = 60;
        gameStarted = false;
        currentSessionId = null;
        // 不要清除 playerName，這樣可以在排行榜中找到當前玩家
        
        showDebug('遊戲狀態清理完成');
    } catch (error) {
        showDebug('清理遊戲狀態錯誤: ' + error.message, true);
    }
};

// 返回首頁
window.backToHome = function(buttonType) {
    showDebug(`${buttonType} 按鈕被點擊`);
    
    try {
        // 清理所有狀態
        if (currentSessionId) {
            database.ref(`gameSessions/${currentSessionId}`).off();
            currentSessionId = null;
        }
        
        if (html5QrcodeScanner) {
            html5QrcodeScanner.stop().catch(() => {});
            html5QrcodeScanner = null;
        }
        
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
        
        // 重置遊戲狀態
        currentScore = 0;
        timeLeft = 60;
        gameStarted = false;
        playerName = ''; // 清除玩家名稱
        
        // 隱藏所有容器
        ['leaderboardContainer', 'resultContainer', 'game-container', 'waitingMessage'].forEach(id => {
            const container = document.getElementById(id);
            if (container) {
                container.style.display = 'none';
            }
        });
        
        // 顯示輸入界面
        const inputContainer = document.querySelector('.input-container');
        if (inputContainer) {
            inputContainer.style.display = 'block';
            const nameInput = document.querySelector('input[type="text"]');
            if (nameInput) {
                nameInput.value = '';
            }
        }
        
        showDebug(`${buttonType} 處理完成`);
    } catch (error) {
        showDebug(`${buttonType} 處理錯誤: ` + error.toString());
    }
};

// 顯示排行榜
window.showLeaderboard = function(fromResultPage = false) {
    showDebug('顯示排行榜');
    const leaderboardList = document.getElementById('leaderboardList');
    leaderboardList.innerHTML = '';
    
    // 隱藏其他容器
    document.querySelector('.input-container').style.display = 'none';
    document.querySelector('.game-container').style.display = 'none';
    document.getElementById('resultContainer').style.display = 'none';
    document.getElementById('leaderboardContainer').style.display = 'block';
    
    database.ref('gameSessions').once('value')
        .then((snapshot) => {
            const sessions = snapshot.val();
            const scores = [];
            
            if (sessions) {
                Object.values(sessions).forEach(session => {
                    if (session.scores) {
                        Object.entries(session.scores).forEach(([name, data]) => {
                            if (data.score !== undefined && data.completed) {
                                scores.push({
                                    name: name,
                                    score: data.score,
                                    timestamp: data.timestamp || Date.now(),
                                    isCurrentPlayer: name === playerName
                                });
                            }
                        });
                    }
                });
            }
            
            // 排序分數
            scores.sort((a, b) => b.score - a.score);
            
            // 找到當前玩家的位置
            const currentPlayerIndex = scores.findIndex(s => s.isCurrentPlayer);
            
            // 顯示所有分數
            scores.forEach((score, index) => {
                const scoreElement = document.createElement('div');
                scoreElement.className = 'leaderboard-item';
                if (score.isCurrentPlayer) {
                    scoreElement.classList.add('current-player');
                }
                
                scoreElement.innerHTML = `
                    <span class="rank">${index + 1}</span>
                    <span class="name">${score.name}</span>
                    <span class="score">${score.score}</span>
                `;
                
                leaderboardList.appendChild(scoreElement);
            });
            
            // 如果是從結果頁面來的，滾動到當前玩家的位置
            if (fromResultPage && currentPlayerIndex !== -1) {
                const playerElement = leaderboardList.children[currentPlayerIndex];
                if (playerElement) {
                    playerElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        });
};

// 查找可用會話
async function findAvailableSession() {
    showDebug('尋找可用會話');
    const snapshot = await database.ref('gameSessions').once('value');
    const sessions = snapshot.val() || {};
    
    // 查找等待中的會話
    for (const [sessionId, session] of Object.entries(sessions)) {
        if (session.status === 'waiting' && 
            session.timestamp > Date.now() - 5 * 60 * 1000) { // 只查找5分鐘內的會話
            return sessionId;
        }
    }
    return null;
}

// 開始遊戲函數
window.startGame = async function() {
    showDebug('開始遊戲函數被調用');
    const nameInput = document.querySelector('input[type="text"]');
    const newPlayerName = nameInput.value.trim();
    
    if (!newPlayerName) {
        alert('請輸入姓名');
        return;
    }

    // 更新玩家名稱
    playerName = newPlayerName;
    showDebug('玩家名稱: ' + playerName);
    
    // 顯示等待訊息，隱藏輸入界面
    document.getElementById('waitingMessage').style.display = 'block';
    document.querySelector('.input-container').style.display = 'none';
    document.querySelector('.game-container').style.display = 'none';
    
    try {
        // 清理舊的會話
        if (currentSessionId) {
            database.ref(`gameSessions/${currentSessionId}`).off();
            currentSessionId = null;
        }

        // 尋找可用的會話
        const availableSession = await findAvailableSession();
        showDebug('尋找可用會話結果: ' + (availableSession ? '找到' : '未找到'));

        if (availableSession) {
            // 加入現有會話
            currentSessionId = availableSession;
            await database.ref(`gameSessions/${currentSessionId}`).update({
                player2: playerName,
                status: 'ready'
            });
            showDebug('已加入現有會話');
        } else {
            // 創建新會話
            const newSessionRef = await database.ref('gameSessions').push({
                player1: playerName,
                status: 'waiting',
                timestamp: Date.now()
            });
            currentSessionId = newSessionRef.key;
            showDebug('已創建新會話');
        }

        // 監聽會話狀態
        database.ref(`gameSessions/${currentSessionId}`).on('value', (snapshot) => {
            const session = snapshot.val();
            showDebug('會話狀態更新: ' + JSON.stringify(session));
            
            if (session && session.status === 'ready') {
                document.getElementById('waitingMessage').style.display = 'none';
                document.querySelector('.game-container').style.display = 'block';
                
                // 顯示玩家信息
                document.querySelector('.player-info').textContent = `參加者：${playerName}`;
                
                if (!gameStarted) {
                    gameStarted = true;
                    startTimer();
                    updateScore();
                    initializeScanner();
                }
            } else {
                // 保持等待狀態
                document.getElementById('waitingMessage').style.display = 'block';
                document.querySelector('.game-container').style.display = 'none';
            }
        });

    } catch (error) {
        showDebug('開始遊戲錯誤: ' + error.message, true);
        alert('發生錯誤：' + error.message);
    }
};

// 遊戲結束處理
window.endGame = function() {
    showDebug('遊戲結束');
    
    try {
        // 停止掃描器和計時器
        if (html5QrcodeScanner) {
            html5QrcodeScanner.stop().catch(err => {
                showDebug('停止掃描器錯誤: ' + err.message, true);
            });
            html5QrcodeScanner = null;
        }
        
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
        
        // 更新分數到 Firebase
        if (currentSessionId && playerName) {
            const scoreData = {
                score: currentScore,
                timestamp: Date.now(),
                completed: true
            };
            
            database.ref(`gameSessions/${currentSessionId}/scores/${playerName}`).update(scoreData)
                .then(() => {
                    showDebug('分數已更新到 Firebase');
                    checkFinalResult();
                })
                .catch(error => {
                    showDebug('更新分數錯誤: ' + error.message, true);
                });
        }
        
        document.querySelector('.game-container').style.display = 'none';
        
    } catch (error) {
        showDebug('結束遊戲錯誤: ' + error.message, true);
    }
};

// 檢查最終結果
function checkFinalResult() {
    if (!currentSessionId) return;
    
    database.ref(`gameSessions/${currentSessionId}/scores`).once('value')
        .then((snapshot) => {
            const scores = snapshot.val() || {};
            const players = Object.entries(scores)
                .filter(([_, data]) => data.completed)
                .map(([name, data]) => ({
                    name,
                    score: data.score
                }));
            
            if (players.length >= 2) {
                // 找出當前玩家和對手
                const currentPlayer = players.find(p => p.name === playerName);
                const opponent = players.find(p => p.name !== playerName);
                
                let resultMessage = '';
                if (currentPlayer.score > opponent.score) {
                    resultMessage = `恭喜你獲勝！\n你的分數：${currentPlayer.score}\n對手分數：${opponent.score}`;
                } else if (currentPlayer.score < opponent.score) {
                    resultMessage = `很遺憾，你輸了。\n你的分數：${currentPlayer.score}\n對手分數：${opponent.score}`;
                } else {
                    resultMessage = `平局！\n你的分數：${currentPlayer.score}\n對手分數：${opponent.score}`;
                }
                
                showResult(resultMessage);
            } else {
                showResult(`遊戲完成！\n你的分數：${currentScore}\n等待對手完成...`);
            }
        });
}

// 顯示結果
function showResult(message) {
    const resultContainer = document.getElementById('resultContainer');
    resultContainer.style.display = 'block';
    
    const resultMessage = document.getElementById('resultMessage');
    if (resultMessage) {
        resultMessage.textContent = message;
    }
}

// 計時器函數
function startTimer() {
    if (timer) {
        clearInterval(timer);
    }
    
    timeLeft = 30;
    updateTimerDisplay();
    
    timer = setInterval(() => {
        timeLeft--;
        updateTimerDisplay();
        
        if (timeLeft <= 0) {
            clearInterval(timer);
            endGame();
        }
    }, 1000);
}

function updateTimerDisplay() {
    document.querySelector('.timer span').textContent = timeLeft;
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

// 處理QR Code掃描結果
function handleQRCode(qrContent) {
    if (quizQuestions[qrContent]) {
        // 暫停掃描
        if (html5QrcodeScanner) {
            html5QrcodeScanner.pause();
        }
        
        showQuestion(qrContent);
    }
}

// 顯示題目
function showQuestion(qrContent) {
    const question = quizQuestions[qrContent];
    document.querySelector('.scanner-container').style.display = 'none';
    
    const questionContainer = document.querySelector('.question-container');
    questionContainer.style.display = 'block';
    
    document.getElementById('questionText').textContent = question.question;
    
    const optionButtons = document.querySelectorAll('.option-btn');
    optionButtons.forEach((btn, index) => {
        const option = ['A', 'B', 'C'][index];
        btn.textContent = `${option}. ${question.options[option]}`;
        
        btn.style.backgroundColor = 'white';
        btn.style.color = '#333';
        
        btn.onclick = () => handleAnswer(qrContent, option);
    });
}

// 處理答案
function handleAnswer(qrContent, selectedOption) {
    const question = quizQuestions[qrContent];
    
    if (selectedOption === question.correctAnswer) {
        currentScore += 10;
        playScoreAnimation(true);
    } else {
        currentScore = Math.max(0, currentScore - 5);
        playScoreAnimation(false);
    }
    
    updateScore();
    
    // 返回掃描界面並恢復掃描
    document.querySelector('.question-container').style.display = 'none';
    document.querySelector('.scanner-container').style.display = 'block';
    
    if (html5QrcodeScanner) {
        html5QrcodeScanner.resume();
    }
}

function initializeScanner() {
    const html5QrCode = new Html5Qrcode("reader");
    const config = {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0
    };

    html5QrCode.start(
        { facingMode: "environment" },
        config,
        (decodedText) => {
            // 成功掃描到 QR Code
            console.log("掃描到QR Code:", decodedText);
            handleQRCode(decodedText);
        },
        (error) => {
            // 掃描錯誤時不需要處理
        }
    ).catch((err) => {
        console.error("啟動掃描器失敗:", err);
    });

    // 保存掃描器實例以便後續使用
    html5QrcodeScanner = html5QrCode;
}

// 在頁面卸載時清理
window.addEventListener('beforeunload', cleanupGame);

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
        mainLeaderboardBtn.onclick = () => showLeaderboard(false);
    }
    
    // 結果頁面的排行榜按鈕
    const resultLeaderboardBtn = document.querySelector('.result-container .leaderboard-btn');
    if (resultLeaderboardBtn) {
        resultLeaderboardBtn.onclick = () => showLeaderboard(true);
    }
    
    // 再次挑戰按鈕
    const restartButton = document.querySelector('.restart-btn');
    if (restartButton) {
        restartButton.onclick = () => backToHome('再次挑戰');
    }
    
    // 排行榜按鈕
    const leaderboardButtons = document.querySelectorAll('.leaderboard-btn');
    leaderboardButtons.forEach(button => {
        button.onclick = () => showLeaderboard(false);
    });
});

// 其他輔助函數
function cleanupGame() {
    showDebug('執行清理遊戲狀態');
    try {
        // ... cleanupGame 函數的內容保持不變 ...
    } catch (error) {
        showDebug('清理遊戲狀態錯誤: ' + error.message, true);
    }
} 