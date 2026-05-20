from datetime import datetime

def get_current_time_info() -> str:
    """获取当前时间的格式化字符串，带上时间段判断"""
    now = datetime.now()
    hour = now.hour
    
    time_period = "深夜"
    if 5 <= hour < 9:
        time_period = "早晨"
    elif 9 <= hour < 12:
        time_period = "上午"
    elif 12 <= hour < 14:
        time_period = "中午"
    elif 14 <= hour < 18:
        time_period = "下午"
    elif 18 <= hour < 23:
        time_period = "晚上"
        
    weekdays = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"]
    weekday_str = weekdays[now.weekday()]
    
    return f"当前现实时间：{now.strftime('%Y-%m-%d %H:%M')}，{weekday_str}，{time_period}。"
