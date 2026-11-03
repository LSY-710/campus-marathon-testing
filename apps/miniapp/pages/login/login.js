const { request, showError } = require("../../utils/api");

Page({
  data: {
    username: "user",
    password: "user1234",
    submitting: false,
  },

  onUsernameInput(event) {
    this.setData({ username: event.detail.value });
  },

  onPasswordInput(event) {
    this.setData({ password: event.detail.value });
  },

  async submit() {
    this.setData({ submitting: true });
    try {
      const payload = await request("/api/auth/login", {
        method: "POST",
        data: {
          username: this.data.username,
          password: this.data.password,
        },
      });
      getApp().setSession(payload.token, payload.user);
      wx.showToast({ title: "登录成功", icon: "success" });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (error) {
      this.setData({ submitting: false });
      showError(error);
    }
  },
});
