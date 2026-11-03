function request(path, options = {}) {
  const app = getApp();
  const token = app.globalData.token;
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${app.globalData.apiBaseUrl}${path}`,
      method: options.method || "GET",
      data: options.data,
      header: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data);
          return;
        }
        if (response.statusCode === 401) {
          app.clearSession();
        }
        reject(new Error(response.data?.error?.message || "请求失败"));
      },
      fail() {
        reject(new Error("无法连接服务，请检查 API 地址"));
      },
    });
  });
}

function showError(error) {
  wx.showToast({
    title: error.message || "操作失败",
    icon: "none",
  });
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(
    date.getHours(),
  ).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function money(event) {
  return Number(event.feeCents) === 0 ? "免费" : `¥${event.feeYuan}`;
}

module.exports = {
  request,
  showError,
  formatDate,
  money,
};
