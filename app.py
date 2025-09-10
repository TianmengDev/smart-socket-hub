import os
import json
import random
import string
import time
import hmac
import hashlib
import base64
import urllib.parse
from datetime import datetime, timedelta
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
import paho.mqtt.client as mqtt
import requests
import threading

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-here'
socketio = SocketIO(app, cors_allowed_origins="*")

# MQTT配置
MQTT_HOST = ""
MQTT_PORT = 1833
MQTT_CLIENT_ID = ""
MQTT_TOPIC = ""

# 钉钉机器人配置
DINGTALK_WEBHOOK = ""  # 钉钉Webhook地址
DINGTALK_SECRET = ""  # 钉钉机器人密钥，用于签名认证

# 全局变量
mqtt_client = None
socket_status = {"status": "unknown", "signal": "unknown", "last_update": None, "online": False}
verification_codes = {}  # 存储验证码 {code: timestamp}
last_device_response = None  # 设备最后响应时间

def generate_verification_code():
    """生成6位数字验证码"""
    return ''.join(random.choices(string.digits, k=6))

def get_dingtalk_sign():
    """生成钉钉机器人签名"""
    timestamp = str(round(time.time() * 1000))
    secret_enc = DINGTALK_SECRET.encode('utf-8')
    string_to_sign = f'{timestamp}\n{DINGTALK_SECRET}'
    string_to_sign_enc = string_to_sign.encode('utf-8')
    hmac_code = hmac.new(secret_enc, string_to_sign_enc, digestmod=hashlib.sha256).digest()
    sign = urllib.parse.quote_plus(base64.b64encode(hmac_code))
    return timestamp, sign

def send_dingtalk_message(message):
    """发送消息到钉钉机器人"""
    try:
        # 生成签名
        timestamp, sign = get_dingtalk_sign()
        
        # 构建带签名的URL
        webhook_url = f"{DINGTALK_WEBHOOK}&timestamp={timestamp}&sign={sign}"
        
        # 构建消息体
        data = {
            "msgtype": "text",
            "text": {
                "content": message
            }
        }
        
        # 发送请求
        response = requests.post(webhook_url, json=data)
        result = response.json()
        
        if response.status_code == 200 and result.get('errcode') == 0:
            print("钉钉消息发送成功")
        else:
            print(f"钉钉消息发送失败: {result.get('errmsg', '未知错误')}")
    except Exception as e:
        print(f"发送钉钉消息异常: {e}")
        # 备用方案：打印到控制台
        print(f"钉钉消息(控制台): {message}")

def clean_expired_codes():
    """清理过期的验证码"""
    current_time = time.time()
    expired_codes = [code for code, timestamp in verification_codes.items() 
                    if current_time - timestamp > 300]  # 5分钟过期
    for code in expired_codes:
        del verification_codes[code]

def check_device_online():
    """检查设备在线状态"""
    global last_device_response
    if last_device_response is None:
        socket_status["online"] = False
        return False
    
    # 如果30秒内没有收到设备响应，认为设备离线
    if time.time() - last_device_response > 30:
        if socket_status["online"]:  # 只在状态变化时打印和推送
            print("设备离线检测：设备可能已断电或断网")
            socket_status["online"] = False
            socket_status["status"] = "offline"
            socket_status["signal"] = "offline"
            socket_status["last_update"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            # 推送离线状态到前端
            socketio.emit('status_update', socket_status)
        return False
    return True

def on_connect(client, userdata, flags, rc):
    """MQTT连接回调"""
    if rc == 0:
        print("MQTT连接成功")
        client.subscribe(MQTT_TOPIC)
        # 不再自动查询状态，等待用户手动刷新
        print("MQTT连接成功，等待手动刷新状态")
    else:
        print(f"MQTT连接失败，返回码: {rc}")

def on_message(client, userdata, msg):
    """MQTT消息接收回调"""
    global last_device_response
    message = msg.payload.decode('utf-8')
    print(f"收到MQTT消息: {message}")
    
    # 更新设备最后响应时间
    last_device_response = time.time()
    socket_status["online"] = True
    
    # 解析消息更新插座状态
    if message == "n1":
        socket_status["status"] = "on"
    elif message == "f1":
        socket_status["status"] = "off"
    elif message.startswith("s-"):
        socket_status["signal"] = message[2:]  # 去掉"s-"前缀
    elif message == "rest_ok":
        print("设备重启成功")
    
    socket_status["last_update"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # 通过WebSocket推送状态更新到前端
    socketio.emit('status_update', socket_status)

def init_mqtt():
    """初始化MQTT客户端"""
    global mqtt_client
    mqtt_client = mqtt.Client(MQTT_CLIENT_ID)
    mqtt_client.on_connect = on_connect
    mqtt_client.on_message = on_message
    
    try:
        mqtt_client.connect(MQTT_HOST, MQTT_PORT, 60)
        mqtt_client.loop_start()
    except Exception as e:
        print(f"MQTT连接异常: {e}")

@app.route('/')
def index():
    """首页"""
    return render_template('index.html')

@app.route('/api/status')
def get_status():
    """获取插座状态API"""
    return jsonify(socket_status)

@app.route('/api/request_verification', methods=['POST'])
def request_verification():
    """请求验证码API"""
    data = request.get_json()
    action = data.get('action')  # 'on' 或 'off'
    
    if action not in ['on', 'off']:
        return jsonify({"success": False, "message": "无效的操作"})
    
    # 生成验证码
    code = generate_verification_code()
    verification_codes[code] = time.time()
    
    # 发送到钉钉
    action_text = "开启" if action == "on" else "关闭"
    message = f"【天蒙洗衣机管理系统】\n有人请求{action_text}插座\n验证码: {code}\n有效期: 5分钟"
    send_dingtalk_message(message)
    
    # 清理过期验证码
    clean_expired_codes()
    
    return jsonify({"success": True, "message": f"验证码已发送，请查看钉钉消息"})

@app.route('/api/control', methods=['POST'])
def control_socket():
    """控制插座API"""
    data = request.get_json()
    action = data.get('action')  # 'on' 或 'off'
    code = data.get('code')
    
    if not code:
        return jsonify({"success": False, "message": "请输入验证码"})
    
    # 检查设备在线状态
    if not check_device_online():
        return jsonify({"success": False, "message": "设备离线，无法控制插座"})
    
    # 验证验证码
    if code not in verification_codes:
        return jsonify({"success": False, "message": "验证码无效"})
    
    # 检查验证码是否过期
    if time.time() - verification_codes[code] > 300:  # 5分钟
        del verification_codes[code]
        return jsonify({"success": False, "message": "验证码已过期"})
    
    # 验证成功，删除验证码
    del verification_codes[code]
    
    # 发送MQTT指令
    if mqtt_client:
        if action == "on":
            mqtt_client.publish(MQTT_TOPIC, "a1")
        elif action == "off":
            mqtt_client.publish(MQTT_TOPIC, "b1")
        else:
            return jsonify({"success": False, "message": "无效的操作"})
        
        action_text = "开启" if action == "on" else "关闭"
        return jsonify({"success": True, "message": f"插座{action_text}指令已发送"})
    else:
        return jsonify({"success": False, "message": "MQTT连接异常"})

@app.route('/api/refresh', methods=['POST'])
def refresh_status():
    """刷新插座状态API"""
    if not mqtt_client:
        return jsonify({"success": False, "message": "MQTT连接异常"})
    
    # 清理过期验证码
    clean_expired_codes()
    
    # 检查设备在线状态
    check_device_online()
    
    try:
        print("手动刷新状态：发送查询指令")
        mqtt_client.publish(MQTT_TOPIC, "q1")
        mqtt_client.publish(MQTT_TOPIC, "qs")
        
        # 如果设备离线，立即返回离线状态
        if not socket_status["online"]:
            return jsonify({
                "success": True, 
                "message": "查询指令已发送，但设备可能离线",
                "device_offline": True
            })
        
        return jsonify({"success": True, "message": "状态刷新指令已发送"})
    except Exception as e:
        print(f"发送刷新指令异常: {e}")
        return jsonify({"success": False, "message": "发送刷新指令失败"})

@socketio.on('connect')
def handle_connect():
    """WebSocket连接处理"""
    print('客户端已连接')
    emit('status_update', socket_status)

@socketio.on('disconnect')
def handle_disconnect():
    """WebSocket断开处理"""
    print('客户端已断开')

if __name__ == '__main__':
    # 初始化MQTT
    init_mqtt()
    
    # 启动Flask应用
    print("启动天蒙洗衣机管理系统...")
    print("请在钉钉群中添加机器人，并将webhook URL替换到代码中的DINGTALK_WEBHOOK变量")
    socketio.run(app, host='0.0.0.0', port=5000, debug=True) 