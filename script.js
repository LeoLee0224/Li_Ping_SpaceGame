// 初始化 Firebase
const app = firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// 初始化變量
let currentScore = 0;
let timer = null;
let timeLeft = 60;
let currentSessionId = null;
let playerName = '';
let gameStarted = false;
let leaderboard = JSON.parse(localStorage.getItem('spaceQuizLeaderboard')) || [];
let gameSession = null;
let html5QrcodeScanner = null;

// 尋找可用的會話
async function findAvailableSession() {
    const snapshot = await database.ref('gameSessions').once('value');
    const sessions = snapshot.val();
    
    if (sessions) {
        for (let sessionId in sessions) {
            const session = sessions[sessionId];
            if (session.status === 'waiting' && !session.player2) {
                return sessionId;
            }
        }
    }
    return null;
}

async function startGame() {
    const nameInput = document.querySelector('input[type="text"]');
    playerName = nameInput.value.trim();
    
    if (!playerName) {
        alert('請輸入姓名');
        return;
    }

    // 隱藏輸入界面，顯示等待訊息
    document.querySelector('.input-container').style.display = 'none';
    document.getElementById('waitingMessage').style.display = 'block';
    document.querySelector('.game-container').style.display = 'none';
    
    try {
        // 清除之前的監聽器
        if (currentSessionId) {
            database.ref(`gameSessions/${currentSessionId}`).off();
        }

        const availableSession = await findAvailableSession();
        
        if (availableSession) {
            console.log('加入現有會話');
            currentSessionId = availableSession;
            // 更新會話狀態
            await database.ref(`gameSessions/${currentSessionId}`).update({
                player2: playerName,
                status: 'ready'
            });
        } else {
            console.log('創建新會話');
            // 創建新會話並等待
            const newSessionRef = await database.ref('gameSessions').push({
                player1: playerName,
                status: 'waiting',
                timestamp: Date.now()
            });
            currentSessionId = newSessionRef.key;
        }

        // 監聽會話狀態變化
        database.ref(`gameSessions/${currentSessionId}`).on('value', (snapshot) => {
            const session = snapshot.val();
            console.log('會話狀態更新:', session);

            if (!session) {
                console.log('會話不存在');
                return;
            }

            if (session.status === 'waiting') {
                console.log('等待玩家加入...');
                document.getElementById('waitingMessage').style.display = 'block';
                document.querySelector('.game-container').style.display = 'none';
            } 
            else if (session.status === 'ready' && !gameStarted) {
                console.log('開始遊戲');
                gameStarted = true;
                initializeGame(session);
            }
        });

    } catch (error) {
        console.error('Error:', error);
        alert('發生錯誤：' + error.message);
    }
}

function initializeGame(session) {
    console.log('初始化遊戲...');
    // 隱藏等待訊息
    document.getElementById('waitingMessage').style.display = 'none';
    // 顯示遊戲界面
    document.querySelector('.game-container').style.display = 'block';
    
    // 設置玩家信息
    const playerInfo = document.querySelector('.player-info');
    playerInfo.textContent = `參加者：${playerName}`;
    
    // 初始化遊戲組件
    startTimer();
    updateScore();
    initializeScanner();
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

function endGame() {
    // 立即停止掃描器
    if (html5QrcodeScanner) {
        html5QrcodeScanner.stop().then(() => {
            console.log('掃描器已停止');
        }).catch(error => {
            console.error('停止掃描器時出錯:', error);
        });
    }
    
    // 停止計時器
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
    
    // 隱藏遊戲界面
    document.querySelector('.game-container').style.display = 'none';
    
    // 更新分數到 Firebase
    if (currentSessionId) {
        database.ref(`gameSessions/${currentSessionId}/scores/${playerName}`).update({
            score: currentScore,
            timestamp: Date.now(),
            completed: true
        });
        
        // 監聽對手分數
        checkGameResults();
    }
}

function checkGameResults() {
    const resultContainer = document.getElementById('resultContainer');
    const finalScoreElement = document.getElementById('finalScore');
    const opponentScoreElement = document.getElementById('opponentScore');
    const resultMessageElement = document.getElementById('resultMessage');
    
    // 顯示結果容器
    resultContainer.style.display = 'block';
    finalScoreElement.textContent = currentScore;
    
    // 監聽一次會話數據
    database.ref(`gameSessions/${currentSessionId}`).once('value', (snapshot) => {
        const session = snapshot.val();
        if (session && session.scores) {
            const scores = session.scores;
            const players = Object.keys(scores);
            
            // 如果有兩個玩家的分數
            if (players.length === 2) {
                const opponent = players.find(p => p !== playerName);
                if (opponent && scores[opponent].completed) {
                    const opponentScore = scores[opponent].score;
                    opponentScoreElement.textContent = opponentScore;
                    
                    // 判斷勝負
                    if (currentScore > opponentScore) {
                        resultMessageElement.textContent = '恭喜你獲勝！';
                        resultMessageElement.style.color = '#28a745';
                    } else if (currentScore < opponentScore) {
                        resultMessageElement.textContent = '很遺憾，你輸了！';
                        resultMessageElement.style.color = '#dc3545';
                    } else {
                        resultMessageElement.textContent = '平局！';
                        resultMessageElement.style.color = '#ffc107';
                    }
                } else {
                    // 對手還未完成
                    opponentScoreElement.textContent = '等待對手完成...';
                    resultMessageElement.textContent = '';
                    
                    // 設置監聽器等待對手完成
                    const opponentRef = database.ref(`gameSessions/${currentSessionId}/scores/${opponent}`);
                    opponentRef.on('value', (opponentSnapshot) => {
                        const opponentData = opponentSnapshot.val();
                        if (opponentData && opponentData.completed) {
                            opponentScoreElement.textContent = opponentData.score;
                            
                            // 判斷勝負
                            if (currentScore > opponentData.score) {
                                resultMessageElement.textContent = '恭喜你獲勝！';
                                resultMessageElement.style.color = '#28a745';
                            } else if (currentScore < opponentData.score) {
                                resultMessageElement.textContent = '很遺憾，你輸了！';
                                resultMessageElement.style.color = '#dc3545';
                            } else {
                                resultMessageElement.textContent = '平局！';
                                resultMessageElement.style.color = '#ffc107';
                            }
                            
                            // 移除監聽器
                            opponentRef.off();
                        }
                    });
                }
            }
        }
    });
}

// 計時器函數
function startTimer() {
    if (timer) {
        clearInterval(timer);
    }
    
    timeLeft = 60;
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

// 顯示排行榜
function showLeaderboard(fromResultPage = false) {
    const leaderboardList = document.getElementById('leaderboardList');
    leaderboardList.innerHTML = ''; // 清空現有內容
    
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
        
        // 收集所有分數
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
        
        // 排序分數（先按分數降序，同分按時間升序）
        scores.sort((a, b) => {
            if (b.score !== a.score) {
                return b.score - a.score;
            }
            return a.timestamp - b.timestamp;
        });
        
        // 找到當前玩家的排名
        const currentPlayerRank = scores.findIndex(score => score.isCurrentPlayer) + 1;
        
        // 顯示前10名
        scores.slice(0, 10).forEach((score, index) => {
            const scoreElement = document.createElement('div');
            scoreElement.className = 'leaderboard-item';
            
            // 添加前三名的特殊類
            if (index < 3) {
                scoreElement.classList.add('top-3', `rank-${index + 1}`);
            }
            
            // 如果是當前玩家，添加特殊樣式
            if (score.isCurrentPlayer) {
                scoreElement.classList.add('current-player');
            }
            
            scoreElement.innerHTML = `
                <span class="rank">${index + 1}</span>
                <span class="name">${score.name}</span>
                <span class="score">${score.score}</span>
                <span class="time">${formatDateTime(score.timestamp)}</span>
            `;
            leaderboardList.appendChild(scoreElement);
        });

        // 如果當前玩家不在前10名但存在排名，顯示其排名
        if (currentPlayerRank > 10 && currentPlayerRank <= scores.length) {
            const separatorElement = document.createElement('div');
            separatorElement.className = 'leaderboard-separator';
            separatorElement.textContent = '...';
            leaderboardList.appendChild(separatorElement);

            const currentPlayerElement = document.createElement('div');
            currentPlayerElement.className = 'leaderboard-item current-player';
            const playerData = scores[currentPlayerRank - 1];
            currentPlayerElement.innerHTML = `
                <span class="rank">${currentPlayerRank}</span>
                <span class="name">${playerData.name}</span>
                <span class="score">${playerData.score}</span>
                <span class="time">${formatDateTime(playerData.timestamp)}</span>
            `;
            leaderboardList.appendChild(currentPlayerElement);
        }
    });
}

// 修改返回按鈕的處理函數
function backFromLeaderboard() {
    console.log('返回按鈕被點擊'); // 調試用
    
    // 清理遊戲狀態
    cleanupGame();
    
    // 隱藏所有容器
    document.getElementById('leaderboardContainer').style.display = 'none';
    document.getElementById('resultContainer').style.display = 'none';
    document.querySelector('.game-container').style.display = 'none';
    
    // 顯示輸入界面
    document.querySelector('.input-container').style.display = 'block';
    
    // 清空輸入框
    const nameInput = document.querySelector('input[type="text"]');
    if (nameInput) {
        nameInput.value = '';
    }
}

function cleanupGame() {
    // 清理 Firebase 監聽器
    if (currentSessionId) {
        database.ref(`gameSessions/${currentSessionId}`).off();
    }
    
    // 停止掃描器
    if (html5QrcodeScanner) {
        html5QrcodeScanner.stop().catch(error => {
            console.error('停止掃描器時出錯:', error);
        });
        html5QrcodeScanner = null;
    }
    
    // 停止計時器
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
    
    // 重置遊戲狀態
    currentScore = 0;
    timeLeft = 60;
    gameStarted = false;
    currentSessionId = null;
    playerName = '';
    
    // 重置分數顯示
    const scoreElement = document.querySelector('.score');
    if (scoreElement) {
        scoreElement.textContent = '目前分數：0';
    }
    
    // 重置計時器顯示
    const timerElement = document.querySelector('.timer span');
    if (timerElement) {
        timerElement.textContent = '60';
    }
}

function restartGame() {
    // 使用相同的清理函數
    cleanupGame();
    
    // 隱藏結果界面
    document.getElementById('resultContainer').style.display = 'none';
    
    // 顯示輸入界面
    document.querySelector('.input-container').style.display = 'block';
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
    
    // 返回按鈕
    const backButton = document.querySelector('.back-btn');
    if (backButton) {
        backButton.onclick = backFromLeaderboard;
        console.log('返回按鈕事件已綁定'); // 調試用
    } else {
        console.log('未找到返回按鈕'); // 調試用
    }
    
    // 再次挑戰按鈕
    const restartButton = document.querySelector('.restart-btn');
    if (restartButton) {
        restartButton.onclick = restartGame;
    }
    
    // 排行榜按鈕
    const leaderboardButtons = document.querySelectorAll('.leaderboard-btn');
    leaderboardButtons.forEach(button => {
        button.onclick = () => showLeaderboard(false);
    });
}); 