// 全局变量
let socket = null;
let currentAction = null;

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    updateCurrentTime();
    setInterval(updateCurrentTime, 1000);
});

// 初始化应用
function initializeApp() {
    // 初始化WebSocket连接
    initializeWebSocket();
    
    // 获取初始状态
    fetchStatus();
    
    // 绑定键盘事件
    document.addEventListener('keydown', handleKeyDown);
}

// 初始化WebSocket连接
function initializeWebSocket() {
    socket = io();
    
    socket.on('connect', function() {
        console.log('WebSocket连接成功');
        updateConnectionStatus(true);
    });
    
    socket.on('disconnect', function() {
        console.log('WebSocket连接断开');
        updateConnectionStatus(false);
    });
    
    socket.on('status_update', function(data) {
        console.log('收到状态更新:', data);
        updateStatus(data);
    });
    
    socket.on('connect_error', function(error) {
        console.error('WebSocket连接错误:', error);
        updateConnectionStatus(false);
    });
}

// 更新连接状态显示
function updateConnectionStatus(connected) {
    const statusDot = document.querySelector('.status-dot');
    const statusText = document.querySelector('.status-text');
    
    if (connected) {
        statusDot.classList.add('connected');
        statusText.textContent = '已连接';
    } else {
        statusDot.classList.remove('connected');
        statusText.textContent = '连接断开';
    }
}

// 更新当前时间
function updateCurrentTime() {
    const now = new Date();
    const timeString = now.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    document.getElementById('currentTime').textContent = timeString;
}

// 获取插座状态
async function fetchStatus() {
    try {
        const response = await fetch('/api/status');
        const data = await response.json();
        updateStatus(data);
    } catch (error) {
        console.error('获取状态失败:', error);
        showToast('获取状态失败', 'error');
    }
}

// 更新状态显示
function updateStatus(data) {
    // 更新插座状态
    const socketStatus = document.getElementById('socketStatus');
    if (data.status === 'offline' || data.online === false) {
        socketStatus.textContent = '设备离线';
        socketStatus.className = 'status-value offline';
    } else if (data.status === 'on') {
        socketStatus.textContent = '开启';
        socketStatus.className = 'status-value on';
    } else if (data.status === 'off') {
        socketStatus.textContent = '关闭';
        socketStatus.className = 'status-value off';
    } else {
        socketStatus.textContent = '未知';
        socketStatus.className = 'status-value unknown';
    }
    
    // 更新Wi-Fi信号
    const wifiSignal = document.getElementById('wifiSignal');
    if (data.signal === 'offline' || data.online === false) {
        wifiSignal.textContent = '设备离线';
        wifiSignal.style.color = '#dc3545';
    } else if (data.signal && data.signal !== 'unknown') {
        wifiSignal.textContent = `-${data.signal}dBm`;
        const signalValue = parseInt(data.signal);
        if (signalValue <= 50) {
            wifiSignal.style.color = '#28a745'; // 信号强
        } else if (signalValue <= 70) {
            wifiSignal.style.color = '#ffc107'; // 信号中等
        } else {
            wifiSignal.style.color = '#dc3545'; // 信号弱
        }
    } else {
        wifiSignal.textContent = '检测中...';
        wifiSignal.style.color = '#666';
    }
    
    // 更新最后更新时间
    const lastUpdate = document.getElementById('lastUpdate');
    if (data.last_update) {
        lastUpdate.textContent = data.last_update;
    }
    
    // 根据设备在线状态启用/禁用控制按钮
    const btnOn = document.getElementById('btnOn');
    const btnOff = document.getElementById('btnOff');
    
    if (data.online === false) {
        btnOn.disabled = true;
        btnOff.disabled = true;
        btnOn.title = '设备离线，无法控制';
        btnOff.title = '设备离线，无法控制';
    } else {
        btnOn.disabled = false;
        btnOff.disabled = false;
        btnOn.title = '';
        btnOff.title = '';
    }
}

// 请求控制操作
async function requestControl(action) {
    if (!action || (action !== 'on' && action !== 'off')) {
        showToast('无效的操作', 'error');
        return;
    }
    
    // 检查按钮是否被禁用（设备离线）
    const controlButton = action === 'on' ? document.getElementById('btnOn') : document.getElementById('btnOff');
    if (controlButton.disabled) {
        showToast('设备离线，无法控制', 'error');
        return;
    }
    
    currentAction = action;
    
    // 显示加载状态
    const originalText = controlButton.textContent;
    controlButton.disabled = true;
    controlButton.textContent = '处理中...';
    
    try {
        const response = await fetch('/api/request_verification', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ action: action })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showVerificationModal(action);
            showToast(data.message, 'success');
        } else {
            showToast(data.message || '请求失败', 'error');
        }
    } catch (error) {
        console.error('请求验证码失败:', error);
        showToast('网络错误，请稍后重试', 'error');
    } finally {
        // 恢复按钮状态
        controlButton.disabled = false;
        controlButton.textContent = originalText;
    }
}

// 显示验证码对话框
function showVerificationModal(action) {
    const modal = document.getElementById('verificationModal');
    const message = document.getElementById('verificationMessage');
    const input = document.getElementById('verificationCode');
    
    const actionText = action === 'on' ? '开启' : '关闭';
    message.textContent = `验证码已发送到钉钉群，请输入验证码来${actionText}插座:`;
    
    input.value = '';
    input.focus();
    
    modal.style.display = 'block';
    
    // 添加动画效果
    setTimeout(() => {
        modal.querySelector('.modal-content').style.transform = 'scale(1)';
    }, 10);
}

// 关闭验证码对话框
function closeModal() {
    const modal = document.getElementById('verificationModal');
    modal.style.display = 'none';
    currentAction = null;
}

// 提交验证码
async function submitVerification() {
    const code = document.getElementById('verificationCode').value.trim();
    
    if (!code) {
        showToast('请输入验证码', 'error');
        return;
    }
    
    if (code.length !== 6 || !/^\d+$/.test(code)) {
        showToast('验证码必须是6位数字', 'error');
        return;
    }
    
    if (!currentAction) {
        showToast('操作已过期，请重新操作', 'error');
        closeModal();
        return;
    }
    
    // 显示提交状态
    const submitBtn = document.querySelector('.btn-primary');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = '验证中...';
    
    try {
        const response = await fetch('/api/control', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action: currentAction,
                code: code
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast(data.message, 'success');
            closeModal();
            // 延迟刷新状态
            setTimeout(fetchStatus, 1000);
        } else {
            showToast(data.message || '验证失败', 'error');
            // 清空输入框
            document.getElementById('verificationCode').value = '';
            document.getElementById('verificationCode').focus();
        }
    } catch (error) {
        console.error('提交验证码失败:', error);
        showToast('网络错误，请稍后重试', 'error');
    } finally {
        // 恢复按钮状态
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
}

// 刷新状态
async function refreshStatus() {
    const button = document.getElementById('btnRefresh');
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = '刷新中...';
    
    try {
        const response = await fetch('/api/refresh', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('状态刷新中...', 'info');
        } else {
            showToast(data.message || '刷新失败', 'error');
        }
    } catch (error) {
        console.error('刷新状态失败:', error);
        showToast('网络错误，请稍后重试', 'error');
    } finally {
        // 恢复按钮状态
        setTimeout(() => {
            button.disabled = false;
            button.textContent = originalText;
        }, 1000);
    }
}

// 显示消息提示
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    
    toastMessage.textContent = message;
    toast.className = `toast ${type}`;
    toast.style.display = 'block';
    
    // 3秒后自动隐藏
    setTimeout(() => {
        toast.style.display = 'none';
    }, 3000);
}

// 键盘事件处理
function handleKeyDown(event) {
    // ESC键关闭模态框
    if (event.key === 'Escape') {
        const modal = document.getElementById('verificationModal');
        if (modal.style.display === 'block') {
            closeModal();
        }
    }
    
    // 在验证码输入框中按回车提交
    if (event.key === 'Enter') {
        const modal = document.getElementById('verificationModal');
        if (modal.style.display === 'block') {
            const activeElement = document.activeElement;
            if (activeElement && activeElement.id === 'verificationCode') {
                submitVerification();
            }
        }
    }
    
    // 快捷键
    if (event.ctrlKey || event.metaKey) {
        switch(event.key) {
            case 'r':
                event.preventDefault();
                refreshStatus();
                break;
        }
    }
}

// 点击模态框背景关闭
document.addEventListener('click', function(event) {
    const modal = document.getElementById('verificationModal');
    if (event.target === modal) {
        closeModal();
    }
});

// 输入框自动格式化
document.addEventListener('input', function(event) {
    if (event.target.id === 'verificationCode') {
        let value = event.target.value.replace(/\D/g, ''); // 只保留数字
        if (value.length > 6) {
            value = value.substring(0, 6);
        }
        event.target.value = value;
    }
});

// 页面可见性变化时重新连接
document.addEventListener('visibilitychange', function() {
    if (!document.hidden && socket) {
        if (!socket.connected) {
            socket.connect();
        }
    }
});

// 网络状态变化处理
window.addEventListener('online', function() {
    showToast('网络已连接', 'success');
    if (socket && !socket.connected) {
        socket.connect();
    }
});

window.addEventListener('offline', function() {
    showToast('网络连接断开', 'error');
}); 