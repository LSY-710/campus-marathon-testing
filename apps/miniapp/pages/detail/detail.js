const { request, showError, formatDate, money } = require("../../utils/api");

Page({
  data: {
    id: "",
    event: null,
    registration: null,
    favorite: false,
    loading: true,
  },

  onLoad(options) {
    this.setData({
      id: options.id,
      favorite: wx.getStorageSync(`favorite:${options.id}`) === true,
    });
    this.loadEvent();
  },

  onShareAppMessage() {
    return {
      title: this.data.event?.title || "校园马拉松赛事",
      path: `/pages/detail/detail?id=${this.data.id}`,
    };
  },

  onShareTimeline() {
    return {
      title: this.data.event?.title || "校园马拉松赛事",
    };
  },

  async loadEvent() {
    try {
      const [eventPayload, registrations] = await Promise.all([
        request(`/api/events/${this.data.id}`),
        getApp().globalData.token
          ? request("/api/me/registrations").catch(() => ({ items: [] }))
          : Promise.resolve({ items: [] }),
      ]);
      const registration =
        registrations.items.find((item) => item.eventId === this.data.id) ||
        null;
      this.setData({
        event: {
          ...eventPayload.event,
          dateText: formatDate(eventPayload.event.startsAt),
          monthText: `${new Date(
            eventPayload.event.startsAt,
          ).getMonth() + 1}月`,
          dayText: String(
            new Date(eventPayload.event.startsAt).getDate(),
          ).padStart(2, "0"),
          priceText: money(eventPayload.event),
          statusClass: `ui-pill-${eventPayload.event.status.toLowerCase()}`,
        },
        registration,
        loading: false,
      });
      wx.setNavigationBarTitle({ title: eventPayload.event.title });
    } catch (error) {
      this.setData({ loading: false });
      showError(error);
    }
  },

  toggleFavorite() {
    const favorite = !this.data.favorite;
    this.setData({ favorite });
    wx.setStorageSync(`favorite:${this.data.id}`, favorite);
    wx.showToast({
      title: favorite ? "收藏成功" : "取消收藏",
      icon: "none",
    });
  },

  openReviews() {
    wx.navigateTo({
      url: `/pages/reviews/reviews?eventId=${this.data.id}`,
    });
  },

  async register() {
    if (!getApp().globalData.token) {
      wx.navigateTo({ url: "/pages/login/login" });
      return;
    }
    if (!this.data.event.registrationOpen) {
      wx.showToast({
        title: this.data.event.registrationClosedReason || "当前不可报名",
        icon: "none",
      });
      return;
    }
    if (this.data.registration) {
      wx.showToast({ title: "你已经报名该赛事", icon: "none" });
      return;
    }
    try {
      const payload = await request(
        `/api/events/${this.data.id}/registrations`,
        { method: "POST" },
      );
      this.setData({ registration: payload.registration });
      wx.showToast({
        title:
          payload.registration.status === "WAIT_PAYMENT"
            ? "报名已创建，待缴费"
            : "报名成功",
        icon: "none",
      });
    } catch (error) {
      showError(error);
    }
  },

  async pay() {
    if (!this.data.registration) return;
    try {
      await request(
        `/api/registrations/${this.data.registration.id}/pay`,
        { method: "POST" },
      );
      this.setData({
        "registration.status": "REGISTERED",
        "registration.paidAt": new Date().toISOString(),
      });
      wx.showToast({ title: "缴费成功", icon: "success" });
    } catch (error) {
      showError(error);
    }
  },
});
