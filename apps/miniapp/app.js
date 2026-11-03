App({
  globalData: {
    apiBaseUrl: "http://127.0.0.1:3000",
    token: wx.getStorageSync("marathon-token") || "",
    user: wx.getStorageSync("marathon-user") || null,
  },

  setSession(token, user) {
    this.globalData.token = token;
    this.globalData.user = user;
    wx.setStorageSync("marathon-token", token);
    wx.setStorageSync("marathon-user", user);
  },

  clearSession() {
    this.globalData.token = "";
    this.globalData.user = null;
    wx.removeStorageSync("marathon-token");
    wx.removeStorageSync("marathon-user");
  },
});
