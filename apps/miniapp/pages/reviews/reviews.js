const { request, showError, formatDate } = require("../../utils/api");

Page({
  data: {
    eventId: "",
    content: "",
    reviews: [],
    submitting: false,
  },

  onLoad(options) {
    this.setData({ eventId: options.eventId });
    this.loadReviews();
  },

  onContentInput(event) {
    this.setData({ content: event.detail.value });
  },

  async loadReviews() {
    try {
      const payload = await request(
        `/api/events/${this.data.eventId}/reviews`,
      );
      this.setData({
        reviews: payload.items.map((item, index) => ({
          ...item,
          sequence: String(index + 1).padStart(2, "0"),
          dateText: formatDate(item.createdAt),
        })),
      });
    } catch (error) {
      showError(error);
    }
  },

  async submitReview() {
    if (!getApp().globalData.token) {
      wx.navigateTo({ url: "/pages/login/login" });
      return;
    }
    if (this.data.content.trim().length < 5) {
      wx.showToast({ title: "评价至少 5 个字", icon: "none" });
      return;
    }
    this.setData({ submitting: true });
    try {
      await request(`/api/events/${this.data.eventId}/reviews`, {
        method: "POST",
        data: { content: this.data.content.trim() },
      });
      this.setData({ content: "", submitting: false });
      wx.showToast({ title: "已提交，等待审核", icon: "none" });
    } catch (error) {
      this.setData({ submitting: false });
      showError(error);
    }
  },
});
